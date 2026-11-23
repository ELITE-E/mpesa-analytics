// CP10a item 4: the hand-written service worker (public/sw.js), its allow-list (written by the
// build from the checksum manifests), the web manifest and the update prompt. The worker runs here
// in a sandbox with fake caches and a fake fetch, so every network call it makes is recorded: it
// precaches only the allow-list, each file with its integrity hash; serves hashed files cache-first
// and pages network-first; leaves everything else alone; and waits for the person before updating.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/service-worker.test.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const WEB = join(import.meta.dirname, "..");
const SW_SOURCE = readFileSync(join(WEB, "public/sw.js"), "utf8");
const { buildAllowList, allowListScript } = await import("../scripts/sw_allow_list.mjs");
const { UpdatePrompt } = await import("../src/components/update-prompt.tsx");
const { updatePrompt } = await import("../src/content/pwa.ts");
const { registerServiceWorker } = await import("../src/lib/service-worker.ts");

const ORIGIN = "https://app.test";
const ALLOW_LIST = {
  version: "v1abc",
  entries: [
    { path: "/", kind: "page", integrity: "sha256-root" },
    { path: "/upload", kind: "page", integrity: "sha256-upload" },
    { path: "/upload.txt", kind: "page", integrity: "sha256-uploadtxt" },
    { path: "/_next/static/chunks/app.js", kind: "hashed", integrity: "sha256-app" },
    { path: "/runtime/62b8/pyodide/pyodide.asm.wasm", kind: "hashed", integrity: "sha256-wasm" },
  ],
};

/** The worker in a sandbox: its listeners, its caches, and every fetch it made. */
function loadWorker({ network = true, cached = {} } = {}) {
  const listeners = {};
  const fetched = [];
  const stores = new Map();
  const calls = { skipWaiting: 0, claim: 0 };
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async put(key, response) {
        store.set(new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname, response);
      },
      async match(key) {
        return store.get(new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname);
      },
      async keys() {
        return [...store.keys()].map((path) => new Request(ORIGIN + path));
      },
    };
  };
  for (const [name, entries] of Object.entries(cached)) {
    const store = new Map(Object.entries(entries).map(([path, text]) => [path, new Response(text)]));
    stores.set(name, store);
  }
  const caches = {
    open: async (name) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const fetchStub = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    fetched.push({ path: url.pathname + url.search, integrity: init.integrity ?? input.integrity ?? "" });
    if (!network) throw new TypeError("offline");
    return new Response(`network ${url.pathname}`);
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, listener) => (listeners[type] = listener),
    skipWaiting: async () => (calls.skipWaiting += 1),
    clients: { claim: async () => (calls.claim += 1) },
    importScripts: (url) => {
      assert.equal(url, "/sw-allow-list.js");
      self.SW_ALLOW_LIST = ALLOW_LIST;
    },
  };
  // In a worker the global object is `self`, so importScripts and caches are globals too.
  Object.assign(self, { caches, fetch: fetchStub, Request, Response, URL, Promise, Map, Set });
  self.self = self;
  vm.runInNewContext(SW_SOURCE, self);
  return { listeners, fetched, stores, calls };
}

/** Dispatch a fetch event; resolve to the response, or null when the worker left it alone. */
async function dispatchFetch(worker, path, init = {}) {
  let responded = null;
  worker.listeners.fetch({
    request: new Request(path.startsWith("http") ? path : ORIGIN + path, init),
    respondWith: (promise) => (responded = promise),
  });
  return responded === null ? null : await responded;
}

/** Run the install step to the end. */
async function install(worker) {
  let done = null;
  worker.listeners.install({ waitUntil: (promise) => (done = promise) });
  return done;
}

test("install precaches exactly the allow-list, each file with its integrity, and does not skip waiting", async () => {
  const worker = loadWorker();
  await install(worker);
  assert.deepEqual(
    worker.fetched,
    ALLOW_LIST.entries.map((entry) => ({ path: entry.path, integrity: entry.integrity })),
  );
  assert.deepEqual([...worker.stores.keys()], ["mpesa-analytics-v1abc"]);
  assert.equal(worker.stores.get("mpesa-analytics-v1abc").size, ALLOW_LIST.entries.length);
  assert.equal(worker.calls.skipWaiting, 0);
});

test("an install that cannot fetch every file fails, so a half cache is never used", async () => {
  const worker = loadWorker({ network: false });
  await assert.rejects(() => install(worker));
});

test("a request for anything not on the allow-list is left to the network and never cached", async () => {
  const worker = loadWorker();
  for (const path of ["/statement.pdf", "/api/anything", "/unlisted.js", "https://example.invalid/upload"]) {
    assert.equal(await dispatchFetch(worker, path), null, path);
  }
  assert.deepEqual(worker.fetched, []);
});

test("a request that is not a GET is left alone, even to a listed path", async () => {
  const worker = loadWorker();
  assert.equal(await dispatchFetch(worker, "/upload", { method: "POST", body: "x" }), null);
  assert.deepEqual(worker.fetched, []);
});

test("a HEAD for a listed page (a link prefetch) is answered from the cache, with no body and no network", async () => {
  const worker = loadWorker({ network: false, cached: { "mpesa-analytics-v1abc": { "/upload": "cached upload" } } });
  const response = await dispatchFetch(worker, "/upload", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.deepEqual(worker.fetched, []);
  assert.equal(await dispatchFetch(worker, "/unlisted", { method: "HEAD" }), null);
});

test("hashed files come from the cache first, and are fetched with their integrity only when missing", async () => {
  const worker = loadWorker({ cached: { "mpesa-analytics-v1abc": { "/_next/static/chunks/app.js": "cached app" } } });
  assert.equal(await (await dispatchFetch(worker, "/_next/static/chunks/app.js")).text(), "cached app");
  assert.deepEqual(worker.fetched, []);
  const wasm = await dispatchFetch(worker, "/runtime/62b8/pyodide/pyodide.asm.wasm");
  assert.equal(await wasm.text(), "network /runtime/62b8/pyodide/pyodide.asm.wasm");
  assert.deepEqual(worker.fetched, [{ path: "/runtime/62b8/pyodide/pyodide.asm.wasm", integrity: "sha256-wasm" }]);
});

test("pages come from the network first, with their integrity, and from the cache when offline", async () => {
  const online = loadWorker({ cached: { "mpesa-analytics-v1abc": { "/upload": "cached upload" } } });
  assert.equal(await (await dispatchFetch(online, "/upload")).text(), "network /upload");
  assert.deepEqual(online.fetched, [{ path: "/upload", integrity: "sha256-upload" }]);
  const offline = loadWorker({ network: false, cached: { "mpesa-analytics-v1abc": { "/upload": "cached upload" } } });
  assert.equal(await (await dispatchFetch(offline, "/upload")).text(), "cached upload");
});

test("a page's query string is ignored when matching the allow-list", async () => {
  const worker = loadWorker({ network: false, cached: { "mpesa-analytics-v1abc": { "/upload.txt": "cached rsc", "/": "cached home" } } });
  assert.equal(await (await dispatchFetch(worker, "/upload.txt?_rsc=abc")).text(), "cached rsc");
  assert.equal(await (await dispatchFetch(worker, "/?import=3")).text(), "cached home");
});

test("the update waits for the person: only their message makes the new worker take over", async () => {
  const worker = loadWorker();
  worker.listeners.message({ data: { type: "something else" } });
  assert.equal(worker.calls.skipWaiting, 0);
  worker.listeners.message({ data: { type: "SKIP_WAITING" } });
  assert.equal(worker.calls.skipWaiting, 1);
});

test("activating removes the app's older caches only, and takes over open pages", async () => {
  const worker = loadWorker({ cached: { "mpesa-analytics-old": {}, "mpesa-analytics-v1abc": {}, "someone-else": {} } });
  let done = null;
  worker.listeners.activate({ waitUntil: (promise) => (done = promise) });
  await done;
  assert.deepEqual([...worker.stores.keys()].sort(), ["mpesa-analytics-v1abc", "someone-else"]);
  assert.equal(worker.calls.claim, 1);
});

test("the worker's source is short, plain, and fetches only through its allow-listed helper", () => {
  const lines = SW_SOURCE.split("\n").length;
  assert.ok(lines <= 140, `${lines} lines`);
  assert.equal(SW_SOURCE.match(/\bfetch\(/g).length, 1, "one fetch call in the whole worker");
  const helper = SW_SOURCE.slice(SW_SOURCE.indexOf("function fetchListed"));
  assert.ok(/\bfetch\(/.test(helper.slice(0, helper.indexOf("\n}"))), "the fetch call is inside fetchListed");
  for (const banned of ["arrayBuffer", "formData", "blob()", "request.body", "eval(", "cache.addAll(request"]) {
    assert.equal(SW_SOURCE.includes(banned), false, banned);
  }
});

/** A small built app in a temporary folder, as the static export lays it out. */
function fakeOut() {
  const out = mkdtempSync(join(tmpdir(), "sw-out-"));
  const files = {
    "index.html": "<html>home</html>",
    "upload.html": "<html>upload</html>",
    "upload.txt": "rsc",
    "404.html": "<html>404</html>",
    "_next/static/chunks/app-1a2b.js": "app",
    "pdf_reader/reader.worker.js": "worker",
    "manifest.webmanifest": "{}",
    "icon.svg": "<svg/>",
    "_headers": "/\n  Content-Security-Policy: x\n",
    "sw.js": "worker source",
    "runtime/current.json": '{"version": "62b8"}',
    "runtime/62b8/pyodide/pyodide.asm.wasm": "wasm",
    "runtime/62b8/core/core.whl": "wheel",
  };
  const runtimeFiles = { "pyodide/pyodide.asm.wasm": "wasm", "core/core.whl": "wheel" };
  files["runtime/62b8/manifest.json"] = JSON.stringify({
    files: Object.fromEntries(
      Object.entries(runtimeFiles).map(([path, text]) => [path, { sha256: createHash("sha256").update(text).digest("hex") }]),
    ),
  });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
  }
  return out;
}

test("the allow-list holds every shipped file, with its sha256, and nothing the host or the worker owns", () => {
  const out = fakeOut();
  try {
    const list = buildAllowList(out);
    const paths = list.entries.map((entry) => entry.path).sort();
    assert.deepEqual(paths, [
      "/",
      "/_next/static/chunks/app-1a2b.js",
      "/icon.svg",
      "/manifest.webmanifest",
      "/pdf_reader/reader.worker.js",
      "/runtime/62b8/core/core.whl",
      "/runtime/62b8/manifest.json",
      "/runtime/62b8/pyodide/pyodide.asm.wasm",
      "/runtime/current.json",
      "/upload",
      "/upload.txt",
    ]);
    const sha = (text) => `sha256-${createHash("sha256").update(text).digest("base64")}`;
    const byPath = Object.fromEntries(list.entries.map((entry) => [entry.path, entry]));
    assert.equal(byPath["/upload"].integrity, sha("<html>upload</html>"));
    assert.equal(byPath["/runtime/62b8/pyodide/pyodide.asm.wasm"].integrity, sha("wasm"));
    assert.equal(byPath["/upload"].kind, "page");
    assert.equal(byPath["/_next/static/chunks/app-1a2b.js"].kind, "hashed");
    assert.equal(byPath["/runtime/62b8/core/core.whl"].kind, "hashed");
    assert.equal(byPath["/pdf_reader/reader.worker.js"].kind, "page");
    assert.match(list.version, /^[0-9a-f]{16}$/);
    assert.match(allowListScript(list), /^self\.SW_ALLOW_LIST = \{/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a runtime file whose bytes differ from the runtime manifest stops the build", () => {
  const out = fakeOut();
  try {
    writeFileSync(join(out, "runtime/62b8/core/core.whl"), "changed");
    assert.throws(() => buildAllowList(out), /runtime file does not match its manifest/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the web manifest names the app plainly, starts at home, and its generic icons exist", () => {
  const manifest = JSON.parse(readFileSync(join(WEB, "public/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "M-Pesa Analytics");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.length >= 1);
  for (const icon of manifest.icons) assert.ok(existsSync(join(WEB, "public", icon.src)), icon.src);
  const layout = readFileSync(join(WEB, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
});

test("the update prompt says a new version is ready and asks before reloading", () => {
  const text = renderToString(createElement(UpdatePrompt, { onAccept() {}, onLater() {} })).replace(/<[^>]*>/g, " ");
  assert.ok(text.includes(updatePrompt.message));
  assert.ok(text.includes(updatePrompt.acceptLabel));
  assert.ok(text.includes(updatePrompt.laterLabel));
});

test("the app registers the worker once, offers the update when one waits, and reloads only after acceptance", async () => {
  const posted = [];
  const waiting = { postMessage: (message) => posted.push(message) };
  const container = {
    controller: {},
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    async register(url, options) {
      container.registered = [url, options];
      return { waiting, addEventListener() {} };
    },
  };
  let offered = null;
  let reloaded = 0;
  await registerServiceWorker({ serviceWorker: container }, { onUpdate: (accept) => (offered = accept), reload: () => (reloaded += 1) });
  assert.deepEqual(container.registered, ["/sw.js", { scope: "/" }]);
  assert.equal(typeof offered, "function");
  container.listeners.controllerchange?.();
  assert.equal(reloaded, 0, "no reload before the person accepts");
  offered();
  assert.deepEqual(posted, [{ type: "SKIP_WAITING" }]);
  container.listeners.controllerchange();
  assert.equal(reloaded, 1);
});

test("without service worker support nothing is registered and nothing fails", async () => {
  await registerServiceWorker({}, { onUpdate() {}, reload() {} });
});
