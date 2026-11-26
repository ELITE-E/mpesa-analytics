// CP10a item 4 in real Chrome: the static export with its CSP and the hand-written service worker.
// After a first load the worker has precached its allow-list; then, with the network off, a
// synthetic statement is read through the real UI and every request is answered by the worker,
// none by the network (the worker's own network-first attempts fail offline, then it answers from
// its cache). Afterwards Cache Storage holds only allow-listed files and nothing from the
// statement. Every value is invented.
//
// Needs the runtime and the app built (npm run build in web/).
// Run from web/:
//   node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/pwa-chrome.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { start_static_server } from "../scripts/serve_static.mjs";

const OUT = join(import.meta.dirname, "../out");
const FIXTURES = join(import.meta.dirname, "../../tests/fixtures/synthetic");
const IMPORT_TIMEOUT_MS = 300_000;
const PROCEED = "Proceed to Analysis";

/** The built allow-list, read the way the worker reads it. */
function builtAllowList() {
  const sandbox = { self: {} };
  vm.runInNewContext(readFileSync(join(OUT, "sw-allow-list.js"), "utf8"), sandbox);
  return sandbox.self.SW_ALLOW_LIST;
}

let server;
let browser;

before(async () => {
  server = await start_static_server();
  browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("after a first load, a statement is read with the network off; only allow-listed files are cached, none holding statement data", { timeout: 15 * 60 * 1000 }, async () => {
  const list = builtAllowList();
  const listed = new Set(list.entries.map((entry) => entry.path));
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__cspViolations = 0;
    document.addEventListener("securitypolicyviolation", () => {
      window.__cspViolations += 1;
    });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${server.origin}/`);
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute("href"), "/manifest.webmanifest");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: IMPORT_TIMEOUT_MS });
    await page.waitForFunction(
      async (count) => {
        const names = await caches.keys();
        if (names.length !== 1) return false;
        return (await (await caches.open(names[0])).keys()).length === count;
      },
      list.entries.length,
      { timeout: IMPORT_TIMEOUT_MS, polling: 1000 },
    );

    const offline = { network: [], failed: [], workerAttempts: 0 };
    context.on("response", (response) => {
      if (!response.fromServiceWorker() && response.url().startsWith("http")) offline.network.push(new URL(response.url()).pathname);
    });
    context.on("requestfailed", (request) => {
      if (!request.url().startsWith("http")) return;
      // The worker's own network-first attempts fail offline before it answers from the cache.
      const path = new URL(request.url()).pathname;
      // A prefetch the page cancels itself when it navigates (net::ERR_ABORTED) was not blocked.
      if (request.failure()?.errorText === "net::ERR_ABORTED") return;
      if (request.serviceWorker() !== null && listed.has(path)) offline.workerAttempts += 1;
      else offline.failed.push(`${request.method()} ${path} ${request.failure()?.errorText}`);
    });
    await context.setOffline(true);
    await page.goto(`${server.origin}/upload`);
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, "F-GOLDEN.pdf"));
    await page.getByRole("button", { name: PROCEED }).click();
    await page.waitForURL(/\/analysis-summary/, { timeout: IMPORT_TIMEOUT_MS });
    await page.locator("[data-statement-checks]").waitFor({ timeout: 60_000 });
    assert.deepEqual(offline.network, [], "no response came from the network");
    assert.deepEqual(offline.failed, [], "no request of the page or its workers failed; each was answered by the service worker");
    await context.setOffline(false);
    // A same-origin URL not on the allow-list, fetched while online: it must never be cached.
    await page.evaluate(() => fetch("/unlisted-probe.json").catch(() => null));

    const golden = JSON.parse(readFileSync(join(FIXTURES, "F-GOLDEN.expected.json"), "utf8"));
    const needles = [
      golden.verification_token,
      ...golden.rows.slice(0, 5).map((row) => row.receipt_no),
      ...golden.rows.slice(0, 5).map((row) => row.details),
      ...golden.rows.slice(0, 5).map((row) => row.balance),
    ];
    const found = await page.evaluate(async (wanted) => {
      const names = await caches.keys();
      const paths = [];
      const hits = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          paths.push(path);
          if (/\.(wasm|whl|zip)$/.test(path)) continue;
          const text = await (await cache.match(request)).text();
          for (const needle of wanted) if (text.includes(needle)) hits.push([path, needle]);
        }
      }
      return { names, paths, hits };
    }, needles);
    assert.deepEqual(found.names, [`${list.cachePrefix}${list.version}`]);
    assert.deepEqual(found.paths.filter((path) => !listed.has(path)), [], "only allow-listed files are cached");
    assert.equal(found.paths.includes("/unlisted-probe.json"), false);
    assert.deepEqual(found.hits, [], "no statement data in Cache Storage");
    assert.equal(await page.evaluate(() => window.__cspViolations), 0);
  } finally {
    await context.close();
  }
});
