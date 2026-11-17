// CP8b item 1: the app is a static export, served with the architecture CSP plus one SHA-256 hash
// per inline script Next writes. script-src never holds 'unsafe-inline' or 'unsafe-eval'.
// Needs `npm run build` (in web/) first.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { ARCHITECTURE_CSP } from "../harness/serve.js";
import { read_headers, start_static_server } from "../scripts/serve_static.mjs";

const WEB = join(import.meta.dirname, "..");
const OUT = join(WEB, "out");
const ROUTES = [
  "/",
  "/upload",
  "/processing",
  "/recovery",
  "/analysis-summary",
  "/overview",
  "/ledger",
  "/breakdown",
  "/breakdown/spending",
  "/breakdown/people",
  "/breakdown/money-in",
  "/breakdown/cash",
  "/breakdown/savings",
  "/breakdown/fees",
];

/**
 * The built page file for a route: index.html for the home page, else the route's .html file.
 *
 * @param {string} route The route.
 * @returns {string} The file's path.
 */
function page_file(route) {
  return join(OUT, route === "/" ? "index.html" : `${route}.html`);
}
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

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

/**
 * The built HTML file for a route.
 *
 * @param {string} route The route.
 * @returns {string} The page's HTML.
 */
function html_of(route) {
  return readFileSync(page_file(route), "utf8");
}

/**
 * The script-src directive of a CSP.
 *
 * @param {string} csp The policy.
 * @returns {string[]} Its sources.
 */
function script_sources(csp) {
  const directive = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src "));
  return directive.split(/\s+/).slice(1);
}

test("the app is a static export with a page for every route", () => {
  for (const route of ROUTES) assert.ok(existsSync(page_file(route)), route);
});

test("no server code is left: no proxy, no next/server, no headers()", () => {
  assert.equal(existsSync(join(WEB, "proxy.ts")), false);
  const layout = readFileSync(join(WEB, "src/app/layout.tsx"), "utf8");
  assert.equal(layout.includes("next/server"), false);
  const config = readFileSync(join(WEB, "next.config.ts"), "utf8");
  assert.match(config, /output:\s*"export"/);
  assert.equal(/headers\s*\(/.test(config), false);
});

test("every route's CSP is the architecture CSP with script hashes, never unsafe-inline or unsafe-eval", () => {
  const headers = read_headers();
  for (const route of ROUTES) {
    const csp = headers.get(route);
    assert.ok(csp, `no CSP for ${route}`);
    const sources = script_sources(csp);
    assert.equal(sources.includes("'unsafe-inline'"), false, route);
    assert.equal(sources.includes("'unsafe-eval'"), false, route);
    for (const source of sources) {
      assert.ok(
        ["'self'", "'wasm-unsafe-eval'"].includes(source) || /^'sha256-[A-Za-z0-9+/]+=*'$/.test(source),
        `${route}: ${source}`,
      );
    }
    const withoutScripts = (policy) =>
      policy.split(";").map((part) => part.trim()).filter((part) => !part.startsWith("script-src "));
    assert.deepEqual(withoutScripts(csp), withoutScripts(ARCHITECTURE_CSP), route);
  }
});

/**
 * How many inline scripts in a page its CSP does not cover by hash.
 *
 * @param {string} html The page.
 * @param {string} csp The page's policy.
 * @returns {number} The uncovered scripts.
 */
function uncovered_inline_scripts(html, csp) {
  const sources = new Set(script_sources(csp));
  return [...html.matchAll(INLINE_SCRIPT)].filter(
    ([, body]) => !sources.has(`'sha256-${createHash("sha256").update(body).digest("base64")}'`),
  ).length;
}

test("every inline script in every page is covered by a hash in that page's CSP", () => {
  const headers = read_headers();
  for (const route of ROUTES) {
    assert.ok(html_of(route).match(INLINE_SCRIPT), `${route} has inline scripts to check`);
    assert.equal(uncovered_inline_scripts(html_of(route), headers.get(route)), 0, route);
  }
});

test("the static export ships no dev-only vendored files and no harness", () => {
  assert.equal(existsSync(join(OUT, "vendor")), false);
  assert.equal(existsSync(join(OUT, "harness")), false);
  assert.ok(existsSync(join(OUT, "runtime", "current.json")));
  assert.ok(existsSync(join(OUT, "pdf_reader", "reader.worker.js")));
});

test("every route loads in Chrome under its CSP with no violation and no foreign request", async () => {
  for (const route of ROUTES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = [];
    const consoleLines = [];
    context.on("request", (request) => requests.push(request.url()));
    // Counted from before the page's own scripts run, so no early violation is missed.
    await context.addInitScript(() => {
      window.__cspViolations = 0;
      document.addEventListener("securitypolicyviolation", () => {
        window.__cspViolations += 1;
      });
    });
    page.on("console", (message) => consoleLines.push(message.text()));
    await page.goto(`${server.origin}${route}`, { waitUntil: "networkidle" });
    const violations = await page.evaluate(() => window.__cspViolations ?? 0);
    assert.equal(violations, 0, `${route}: CSP violations`);
    assert.deepEqual(
      consoleLines.filter((line) => /Content Security Policy/i.test(line)),
      [],
      route,
    );
    assert.deepEqual(
      requests.filter((url) => !url.startsWith(`${server.origin}/`)),
      [],
      route,
    );
    await context.close();
  }
});

test("the CSP check fails when an inline script is not covered", () => {
  const csp = read_headers().get("/");
  const planted = html_of("/").replace("</body>", "<script>planted()</script></body>");
  assert.equal(uncovered_inline_scripts(planted, csp), 1);
  assert.ok(readdirSync(OUT).length > 0);
});

test("an unknown address gets the 404 page under its CSP with no violation (found by the prototype's browser tests)", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (message) => consoleLines.push(message.text()));
  await context.addInitScript(() => {
    window.__cspViolations = 0;
    document.addEventListener("securitypolicyviolation", () => {
      window.__cspViolations += 1;
    });
  });
  const response = await page.goto(`${server.origin}/no-such-page`, { waitUntil: "networkidle" });
  assert.equal(response.status(), 404);
  assert.equal(await page.evaluate(() => window.__cspViolations ?? 0), 0);
  assert.deepEqual(consoleLines.filter((line) => /Content Security Policy/i.test(line)), []);
  await context.close();
});
