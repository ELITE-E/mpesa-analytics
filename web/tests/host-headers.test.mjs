// CP10b item 1: the host headers, generated from the build for each host the owner may choose
// (Cloudflare Pages or Netlify; both read a `_headers` file). The test runs the generator's command
// line for each host, then reads the file it wrote with its own parser and resolves every route and
// every shipped file the way the hosts do: every rule whose path matches applies, and a header set
// by two matching rules is joined into one value. So a header may come from one matching rule only.
//
// Needs `npm run build` (in web/) first. Run from web/:
//   node --import ./tests/support/register.mjs --test tests/host-headers.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { after, test } from "node:test";

import { ARCHITECTURE_CSP } from "../harness/serve.js";

const WEB = join(import.meta.dirname, "..");
const OUT = join(WEB, "out");
const GENERATOR = join(WEB, "scripts/host_headers.mjs");
const HOSTS = ["cloudflare-pages", "netlify"];
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "x-robots-tag": "noindex",
};
// Cloudflare Pages' documented limits for a _headers file.
const CLOUDFLARE_MAX_RULES = 100;
const CLOUDFLARE_MAX_LINE = 2000;

const scratch = mkdtempSync(join(tmpdir(), "host-headers-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** The _headers file the generator's command line writes for a host, as text. */
function generated(host) {
  const target = join(scratch, host);
  execFileSync(process.execPath, [GENERATOR, "--host", host, "--out", OUT, "--to", target]);
  return readFileSync(join(target, "_headers"), "utf8");
}

/**
 * The rules of a _headers file: a path line, then indented "Name: value" lines, or "! Name" lines
 * that detach a header the host would otherwise add.
 */
function parse(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: [], detached: [] });
      continue;
    }
    const rule = rules.at(-1);
    assert.ok(rule, `header line before any path: ${line}`);
    const detach = line.trim().match(/^!\s*(\S+)$/);
    if (detach) {
      rule.detached.push(detach[1].toLowerCase());
      continue;
    }
    const header = line.trim().match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    assert.ok(header, `not a header line: ${line}`);
    rule.headers.push([header[1].toLowerCase(), header[2]]);
  }
  return rules;
}

/** Whether a rule's path matches a served path: exactly, or as "/prefix/*" (and "/*" matches all). */
function matches(rulePath, servedPath) {
  if (rulePath.endsWith("/*")) return servedPath.startsWith(rulePath.slice(0, -1));
  return rulePath === servedPath;
}

/**
 * A path's headers as a host would serve them: name to the list of values, one per matching rule
 * that sets it. More than one value means the host would join them.
 */
function resolve(rules, servedPath) {
  const headers = new Map();
  for (const rule of rules.filter((candidate) => matches(candidate.path, servedPath))) {
    for (const [name, value] of rule.headers) headers.set(name, [...(headers.get(name) ?? []), value]);
  }
  return headers;
}

/** Every file under a directory. */
function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The path a built file is served at: pages without ".html", the home page at "/". */
function servedPath(file) {
  const path = `/${relative(OUT, file).split(sep).join("/")}`;
  if (path === "/index.html") return "/";
  if (path === "/404.html") return path;
  return path.endsWith(".html") ? path.slice(0, -".html".length) : path;
}

const FILES = filesUnder(OUT).filter((file) => !file.endsWith(`${sep}_headers`));
const PAGES = FILES.filter((file) => file.endsWith(".html"));
const ROUTES = PAGES.map(servedPath);

/** Whether a served path names a file whose name changes whenever its bytes do. */
function isHashed(path) {
  return path.startsWith("/_next/static/") || /^\/runtime\/[0-9a-f]{16}\//.test(path);
}

/** The single value a header resolves to on a path; fails on none or on a joined value. */
function single(headers, name, path) {
  const values = headers.get(name) ?? [];
  assert.equal(values.length, 1, `${path}: ${name} set by ${values.length} matching rules`);
  return values[0];
}

/** The sources of a CSP directive. */
function directive(csp, name) {
  const found = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  return found ? found.split(/\s+/).slice(1) : [];
}

test("the build has the routes the app needs, each a page with inline scripts to hash", () => {
  for (const route of ["/", "/upload", "/overview", "/ledger", "/settings", "/unlock", "/merge", "/breakdown/fees"]) {
    assert.ok(ROUTES.includes(route), route);
  }
  for (const page of PAGES) assert.ok(readFileSync(page, "utf8").match(INLINE_SCRIPT), page);
});

for (const host of HOSTS) {
  test(`${host}: every route's CSP is hash-based, covers each of its inline scripts, and is otherwise the architecture CSP`, () => {
    const rules = parse(generated(host));
    for (const page of PAGES) {
      const route = servedPath(page);
      const csp = single(resolve(rules, route), "content-security-policy", route);
      const scripts = directive(csp, "script-src");
      assert.equal(scripts.includes("'unsafe-inline'"), false, route);
      assert.equal(scripts.includes("'unsafe-eval'"), false, route);
      for (const source of scripts) {
        assert.ok(["'self'", "'wasm-unsafe-eval'"].includes(source) || /^'sha256-[A-Za-z0-9+/]+=*'$/.test(source), `${route}: ${source}`);
      }
      for (const [, body] of readFileSync(page, "utf8").matchAll(INLINE_SCRIPT)) {
        const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
        assert.ok(scripts.includes(hash), `${route}: an inline script has no hash`);
      }
      const withoutScripts = (policy) => policy.split(";").map((part) => part.trim()).filter((part) => !part.startsWith("script-src "));
      assert.deepEqual(withoutScripts(csp), withoutScripts(ARCHITECTURE_CSP), route);
    }
  });

  test(`${host}: every route and every shipped file gets nosniff, no-referrer, COOP same-origin, noindex and a Permissions-Policy denying camera, microphone and geolocation`, () => {
    const rules = parse(generated(host));
    for (const path of [...new Set([...ROUTES, ...FILES.map(servedPath)])]) {
      const headers = resolve(rules, path);
      for (const [name, expected] of Object.entries(SECURITY_HEADERS)) assert.equal(single(headers, name, path), expected, `${path}: ${name}`);
      const permissions = single(headers, "permissions-policy", path).split(",").map((part) => part.trim());
      for (const feature of ["camera", "microphone", "geolocation"]) assert.ok(permissions.includes(`${feature}=()`), `${path}: ${feature}`);
      assert.ok(headers.has("content-security-policy"), `${path}: no CSP`);
    }
  });

  test(`${host}: HTML is no-cache, files with hashed names are immutable, every other shipped file is no-cache`, () => {
    const rules = parse(generated(host));
    for (const file of FILES) {
      const path = servedPath(file);
      const expected = file.endsWith(".html") || !isHashed(path) ? NO_CACHE : IMMUTABLE;
      assert.equal(single(resolve(rules, path), "cache-control", path), expected, path);
    }
    assert.ok(FILES.some((file) => isHashed(servedPath(file))), "the build has hashed files");
  });

  test(`${host}: /robots.txt, which the host may answer itself though no file ships, has its own no-cache rule`, () => {
    const rules = parse(generated(host));
    assert.ok(rules.some((rule) => rule.path === "/robots.txt"), "no /robots.txt rule");
    assert.equal(single(resolve(rules, "/robots.txt"), "cache-control", "/robots.txt"), NO_CACHE);
  });

  test(`${host}: no header is set by two rules that match one path, unknown addresses included`, () => {
    const rules = parse(generated(host));
    const probes = [...ROUTES, ...FILES.map(servedPath), "/robots.txt", "/no-such-page","/_next/static/no-such-chunk.js", "/runtime/current.json"];
    for (const path of probes) {
      for (const [name, values] of resolve(rules, path)) assert.equal(values.length, 1, `${path}: ${name} from ${values.length} rules`);
    }
    assert.ok(single(resolve(rules, "/no-such-page"), "content-security-policy", "/no-such-page"), "the 404 page has the CSP");
  });
}

test("the overlap check itself catches a header set by two matching rules", () => {
  const rules = parse("/*\n  Content-Security-Policy: default-src 'none'\n/overview\n  Content-Security-Policy: default-src 'self'\n");
  assert.equal(resolve(rules, "/overview").get("content-security-policy").length, 2);
});

test("cloudflare-pages: within Pages' limits, and Pages' default Access-Control-Allow-Origin is detached", () => {
  const text = generated("cloudflare-pages");
  const rules = parse(text);
  assert.ok(rules.length <= CLOUDFLARE_MAX_RULES, `${rules.length} rules`);
  for (const line of text.split("\n")) assert.ok(line.length <= CLOUDFLARE_MAX_LINE, `a line of ${line.length} characters`);
  const catchAll = rules.find((rule) => rule.path === "/*");
  assert.ok(catchAll?.detached.includes("access-control-allow-origin"));
});

test("netlify: no detach lines, which Netlify does not read", () => {
  assert.equal(parse(generated("netlify")).some((rule) => rule.detached.length > 0), false);
});

test("an unknown host is refused, and nothing is written", () => {
  const target = join(scratch, "unknown");
  assert.throws(() => execFileSync(process.execPath, [GENERATOR, "--host", "vercel", "--out", OUT, "--to", target], { stdio: "pipe" }));
  assert.equal(existsSync(join(target, "_headers")), false);
});

test("private beta: no sitemap is shipped", () => {
  assert.deepEqual(FILES.map(servedPath).filter((path) => /sitemap/i.test(path)), []);
});

test("the build's own out/_headers is the generator's output for a host", () => {
  const built = readFileSync(join(OUT, "_headers"), "utf8");
  assert.ok(HOSTS.some((host) => generated(host) === built), "out/_headers matches neither host's file");
});

test("the export ships no dotfiles, which a host may refuse to serve and the service worker would fail to precache", () => {
  assert.deepEqual(FILES.map(servedPath).filter((path) => path.split("/").some((part) => part.startsWith("."))), []);
});
