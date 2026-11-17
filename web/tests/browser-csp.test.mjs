// Real-browser verification of the production security headers and nonce
// CSP (proxy.ts, lib/security-headers.ts): headless Chrome over the DevTools
// Protocol (support/cdp-browser.mjs) against the production standalone
// build (support/frontend-server.mjs) and a throwaway instance of the real
// API with a synthetic account (support/test-api.mjs).
//
// What a failure means is kept apart: CSP violations (structured
// `securitypolicyviolation` events and requests blocked with reason "csp"),
// uncaught exceptions, console errors, and network failures are recorded
// and asserted separately.
//
// Requirements: Google Chrome (CHROME_PATH, default
// /usr/bin/google-chrome-stable), the repository's .venv, network access
// to Google Fonts (the build downloads fonts; pages load Material Symbols).
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/browser-csp.test.mjs

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launchBrowser } from "./support/cdp-browser.mjs";
import { effectiveSources, hasKeyword, parseCsp, parseScripts } from "./support/csp.mjs";
import {
  buildForProduction,
  copyAppToTempDir,
  freePort,
  removeTempDir,
  startProductionServer,
} from "./support/frontend-server.mjs";
import { startTestApi } from "./support/test-api.mjs";

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com/";
const MATERIAL_SYMBOLS_FAMILY = "Material Symbols Outlined";
const NO_STATEMENT_TEXT = "No statement is waiting to be processed.";
const INVALID_CREDENTIALS_TEXT = "Incorrect username or password.";
const NO_IMPORTS_TEXT = "No statements yet";
const NONCE_SAMPLE_SIZE = 40;
const SECURITY_HEADER_NAMES = ["x-content-type-options", "referrer-policy", "x-frame-options", "strict-transport-security"];

let appDir;
let web;
let api;
let browser;
// Nonces of every document any browser test loaded.
const browserNonces = [];

before(
  async () => {
    const apiPort = await freePort();
    appDir = copyAppToTempDir();
    await buildForProduction(appDir, `http://127.0.0.1:${apiPort}`);
    web = await startProductionServer(appDir);
    api = await startTestApi({ port: apiPort, webOrigin: web.origin });
    browser = await launchBrowser();
  },
  { timeout: 600_000 },
);

after(async () => {
  await browser?.close();
  await api?.stop();
  await web?.stop();
  removeTempDir(appDir);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open a fresh tab, load `path` and wait for the network to settle;
 * `fresh` bypasses the browser cache so every response comes from the server.
 */
async function openRoute(path, { fresh = false } = {}) {
  const page = await browser.newPage();
  if (fresh) await page.disableCache();
  await page.goto(`${web.origin}${path}`);
  await page.waitForNetworkIdle();
  return page;
}

/** Run `body(page)` on a fresh tab at `path` (see openRoute), always closing the tab. */
async function withRoute(path, body, options) {
  const page = await openRoute(path, options);
  try {
    await body(page);
  } finally {
    await page.close();
  }
}

/** The page's single top-level document request (no full reloads happened). */
function onlyDocument(page) {
  const documents = page.documents();
  assert.equal(
    documents.length,
    1,
    `expected one document load, got ${documents.map((request) => request.url).join(", ")}`,
  );
  return documents[0];
}

/** Script-src nonce of a document response, recorded for the freshness check. */
function documentNonce(documentRequest) {
  const header = documentRequest.headers["content-security-policy"];
  assert.ok(header, `${documentRequest.url}: no Content-Security-Policy`);
  const sources = effectiveSources(parseCsp(header), "script-src-elem");
  const nonces = sources.filter((source) => /^'nonce-/.test(source)).map((source) => source.slice(7, -1));
  assert.equal(nonces.length, 1, `${documentRequest.url}: expected one script nonce`);
  assert.ok(!hasKeyword(sources, "unsafe-inline"), `${documentRequest.url}: script-src has 'unsafe-inline'`);
  assert.ok(!hasKeyword(sources, "unsafe-eval"), `${documentRequest.url}: production script-src has 'unsafe-eval'`);
  browserNonces.push(nonces[0]);
  return nonces[0];
}

/** Describe a request failure for assertion messages. */
function describeFailure(request) {
  const { errorText, blockedReason, corsError } = request.failure;
  return `${request.type} ${request.url}: ${errorText}${blockedReason ? ` (blocked: ${blockedReason})` : ""}${corsError ? ` (CORS: ${corsError})` : ""}`;
}

/**
 * Assert the browser blocked nothing under the CSP: no violation events, no
 * request blocked for "csp", no security log entries.
 */
function assertNoCspProblems(page) {
  assert.deepEqual(page.violations, [], "securitypolicyviolation events");
  const blocked = page.requestList().filter((request) => request.failure?.blockedReason === "csp");
  assert.deepEqual(blocked.map(describeFailure), [], "requests blocked by CSP");
  const securityLog = page.logEntries.filter(
    (entry) => entry.source === "security" || /Content.Security.Policy/i.test(entry.text),
  );
  assert.deepEqual(securityLog.map((entry) => entry.text), [], "CSP messages in the browser log");
}

/**
 * Assert no uncaught exception, console.error or unexpected browser error
 * log; `expectedErrorUrls` lists URLs whose failing status is expected (the
 * browser logs e.g. a 401 response as an error).
 */
function assertNoApplicationErrors(page, expectedErrorUrls = []) {
  assert.deepEqual(page.exceptions, [], "uncaught exceptions");
  assert.deepEqual(page.consoleErrors, [], "console.error calls");
  const unexpected = page.logEntries.filter(
    (entry) => entry.level === "error" && !(entry.source === "network" && expectedErrorUrls.includes(entry.url)),
  );
  assert.deepEqual(unexpected.map((entry) => `${entry.source}: ${entry.text} ${entry.url ?? ""}`), [], "browser error log");
}

/**
 * Network failures that are neither CSP blocks nor cancellations (Next.js
 * aborts superseded prefetches), as readable strings.
 */
function networkFailures(page) {
  return page
    .requestList()
    .filter((request) => request.failure && request.failure.blockedReason !== "csp" && !request.failure.canceled)
    .map(describeFailure);
}

/** Assert the document-level security headers on a browser-seen response. */
function assertSecurityHeaders(response, where) {
  for (const name of SECURITY_HEADER_NAMES) {
    assert.ok(response.headers[name], `${where}: missing ${name}`);
  }
  assert.equal(response.headers["x-content-type-options"], "nosniff", where);
  assert.equal(response.headers["x-powered-by"], undefined, `${where}: X-Powered-By present`);
}

/** Click the header's "Sign in" button and wait for the client-side move to /login. */
async function signInButtonNavigatesClientSide(page) {
  await page.click('button[aria-label="Sign in"]');
  await page.waitFor(
    `location.pathname === "/login" && !!document.querySelector('input[type="password"]')`,
    "client-side navigation to /login",
  );
  await page.waitForNetworkIdle();
  onlyDocument(page);
}

/** Fill in and submit the real login form. */
async function submitLogin(page, username, password) {
  await page.type('input[autocomplete="username"]', username);
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

/** Requests to the test API with the given method and path. */
function apiRequests(page, method, path) {
  return page
    .requestList()
    .filter((request) => request.method === method && new URL(request.url).origin === api.origin && new URL(request.url).pathname === path);
}

// ---------------------------------------------------------------------------
// A. Initial load and hydration
// ---------------------------------------------------------------------------

describe("A. document load and hydration (production build)", () => {
  for (const path of ["/", "/upload", "/recovery"]) {
    test(`${path} loads, hydrates and navigates client-side`, async () => {
      await withRoute(path, async (page) => {
        const document = onlyDocument(page);
        assert.equal(document.status, 200);
        // A type="button" that only works once React has hydrated.
        await signInButtonNavigatesClientSide(page);
        assertNoCspProblems(page);
        assertNoApplicationErrors(page);
        assert.deepEqual(networkFailures(page), [], "network failures");
      });
    });
  }

  test("/processing loads and renders its client-only state", async () => {
    await withRoute("/processing", async (page) => {
      assert.equal(onlyDocument(page).status, 200);
      // The server renders nothing here; only the hydrated client shows it.
      await page.waitFor(
        `document.body.innerText.includes(${JSON.stringify(NO_STATEMENT_TEXT)})`,
        "the client-rendered no-statement card",
      );
      assertNoCspProblems(page);
      assertNoApplicationErrors(page);
      assert.deepEqual(networkFailures(page), [], "network failures");
    });
  });

  test("a nonexistent route shows the 404 page without errors", async () => {
    await withRoute("/does-not-exist", async (page) => {
      const document = onlyDocument(page);
      assert.equal(document.status, 404);
      assert.match(await page.evaluate("document.body.innerText"), /404/);
      assertNoCspProblems(page);
      // The browser logs the 404 document itself as a network error.
      assertNoApplicationErrors(page, [document.url]);
      assert.deepEqual(networkFailures(page), [], "network failures");
    });
  });
});

// ---------------------------------------------------------------------------
// B. Nonce and script enforcement
// ---------------------------------------------------------------------------

describe("B. nonce and script enforcement", () => {
  for (const path of ["/", "/login", "/upload", "/processing", "/recovery", "/does-not-exist"]) {
    test(`${path}: every parser-inserted script carries the response's nonce`, async () => {
      await withRoute(path, async (page) => {
        const document = onlyDocument(page);
        const nonce = documentNonce(document);
        const html = await page.responseBody(document.requestId);
        const served = parseScripts(html);
        assert.ok(served.length > 0, "document has no scripts");
        const wrongNonce = served.filter((script) => script.nonce !== nonce).map((script) => script.src ?? "inline");
        assert.deepEqual(wrongNonce, [], "served <script> tags without the response nonce");

        // In the live DOM, scripts the runtime inserted later carry no nonce
        // and run through 'strict-dynamic' trust; any nonce present must be
        // this response's.
        const servedSources = new Set(served.map((script) => script.src && new URL(script.src, web.origin).href));
        const live = await page.evaluate(
          "[...document.scripts].map((script) => ({ src: script.src, nonce: script.nonce }))",
        );
        const foreignNonce = live.filter((script) => script.nonce && script.nonce !== nonce);
        assert.deepEqual(foreignNonce, [], "live scripts with a different nonce");
        const inserted = live.filter((script) => !script.nonce);
        for (const script of inserted) {
          assert.ok(script.src, "an inline script without nonce exists in the DOM");
          assert.ok(!servedSources.has(script.src), `${script.src} was served without a nonce`);
          assert.equal(new URL(script.src).origin, web.origin, `${script.src} inserted from another origin`);
        }
        assertNoCspProblems(page);
      });
    });
  }

  test(`nonces are 128-bit and never repeat across ${NONCE_SAMPLE_SIZE}+ documents`, async () => {
    const fetched = [];
    for (let index = 0; index < NONCE_SAMPLE_SIZE; index += 1) {
      const response = await fetch(`${web.origin}${index % 2 ? "/" : "/login"}`);
      const header = response.headers.get("content-security-policy");
      fetched.push(/'nonce-([^']+)'/.exec(header)[1]);
    }
    const all = [...browserNonces, ...fetched];
    assert.ok(browserNonces.length >= 6, "browser tests recorded too few nonces");
    for (const nonce of all) {
      assert.equal(Buffer.from(nonce, "base64").length, 16, `nonce ${nonce} is not 16 random bytes`);
    }
    assert.equal(new Set(all).size, all.length, "a nonce was reused");
  });
});

// ---------------------------------------------------------------------------
// C. Dynamically loaded code and client-side navigation
// ---------------------------------------------------------------------------

describe("C. client-side navigation and dynamically loaded chunks", () => {
  test("bottom-nav link to /ledger loads its code and redirects to sign-in", async () => {
    await withRoute("/", async (page) => {
      const document = onlyDocument(page);
      const served = new Set(
        parseScripts(await page.responseBody(document.requestId))
          .filter((script) => script.src)
          .map((script) => new URL(script.src, web.origin).href),
      );

      await page.click('a[href="/ledger"]');
      // /ledger needs a session: its hydrated code sends the user to sign in.
      await page.waitFor(
        `location.pathname === "/login" && new URLSearchParams(location.search).get("next") === "/ledger"`,
        "the ledger page's redirect to /login?next=/ledger",
      );
      await page.waitForNetworkIdle();
      onlyDocument(page);

      const dynamicScripts = page.requestList().filter((request) => request.type === "Script" && !served.has(request.url));
      assert.ok(dynamicScripts.length > 0, "navigation loaded no additional script chunks");
      for (const script of dynamicScripts) {
        assert.equal(script.failure, null, `chunk failed: ${script.failure && describeFailure(script)}`);
        assert.equal(script.status, 200, script.url);
        assert.equal(script.headers["x-content-type-options"], "nosniff", script.url);
      }

      const routerRequests = page.requestList().filter((request) => request.requestHeaders.rsc === "1");
      assert.ok(routerRequests.length > 0, "no client-router (RSC) requests were observed");
      for (const request of routerRequests) {
        if (request.failure?.canceled) continue;
        assert.equal(request.failure, null, `router request failed: ${request.failure && describeFailure(request)}`);
        assert.equal(request.status, 200, request.url);
        assert.equal(request.headers["x-content-type-options"], "nosniff", request.url);
        assert.equal(request.headers["x-powered-by"], undefined, request.url);
      }

      assertNoCspProblems(page);
      assertNoApplicationErrors(page);
      assert.deepEqual(networkFailures(page), [], "network failures");
    });
  });
});

// ---------------------------------------------------------------------------
// D. Login and API connectivity
// ---------------------------------------------------------------------------

describe("D. login form and API connectivity", () => {
  test("a wrong password reaches the API and is reported by the UI", async () => {
    await withRoute("/login?next=%2Foverview", async (page) => {
      await submitLogin(page, api.account.username, "not-the-password-0000");
      const alert = await page.waitFor(
        `document.querySelector('[role="alert"]')?.innerText`,
        "the sign-in error message",
      );
      await page.waitForNetworkIdle();
      // First, so a blocked API request is reported as the CSP problem it is.
      assertNoCspProblems(page);
      assert.match(alert, new RegExp(INVALID_CREDENTIALS_TEXT.replace(".", "\\.")));

      const [loginRequest, ...others] = apiRequests(page, "POST", "/api/v1/auth/login");
      assert.equal(others.length, 0, "more than one login request");
      assert.ok(loginRequest, "no login request reached the API origin");
      assert.equal(loginRequest.failure, null, `login request failed: ${loginRequest.failure && describeFailure(loginRequest)}`);
      assert.equal(loginRequest.status, 401);
      // Handled in the page (fetch), not by a native form submission.
      onlyDocument(page);
      assert.equal(await page.evaluate("location.pathname"), "/login");

      assertNoApplicationErrors(page, [loginRequest.url]);
      assert.deepEqual(networkFailures(page), [], "network failures");
    });
  });

  test("the synthetic account signs in, loads data from the API and signs out", async () => {
    await withRoute("/login?next=%2Foverview", async (page) => {
      await submitLogin(page, api.account.username, api.account.password);
      await page.waitFor(`location.pathname === "/overview"`, "client-side navigation to /overview");
      await page.waitFor(
        `document.body.innerText.includes(${JSON.stringify(NO_IMPORTS_TEXT)})`,
        "the overview's empty state, rendered from API data",
      );
      await page.waitForNetworkIdle();
      onlyDocument(page);

      const [loginRequest] = apiRequests(page, "POST", "/api/v1/auth/login");
      assert.equal(loginRequest.status, 200);
      const token = JSON.parse(await page.responseBody(loginRequest.requestId)).access_token;
      const [listRequest] = apiRequests(page, "GET", "/api/v1/imports");
      assert.ok(listRequest, "the overview made no API request");
      assert.equal(listRequest.failure, null, `API request failed: ${listRequest.failure && describeFailure(listRequest)}`);
      assert.equal(listRequest.status, 200);
      assert.equal(listRequest.requestHeaders.authorization, `Bearer ${token}`);

      await page.click('button[aria-label^="Sign out"]');
      await page.waitFor(`location.pathname === "/login"`, "navigation to /login after sign-out");
      await page.waitForNetworkIdle();
      const [logoutRequest] = apiRequests(page, "POST", "/api/v1/auth/logout");
      assert.equal(logoutRequest?.status, 204, "logout did not reach the API");
      assert.equal(await page.evaluate("sessionStorage.length"), 0, "session left in storage after sign-out");

      for (const request of page.requestList()) {
        assert.ok(!request.url.includes(token), `token in request URL ${request.url}`);
      }
      onlyDocument(page);
      assertNoCspProblems(page);
      assertNoApplicationErrors(page);
      assert.deepEqual(networkFailures(page), [], "network failures");
    });
  });
});

// ---------------------------------------------------------------------------
// E. Material Symbols and external fonts
// ---------------------------------------------------------------------------

describe("E. Material Symbols from Google Fonts", () => {
  test("/upload loads the Material Symbols stylesheet and font and renders icons", async () => {
    await withRoute("/upload", async (page) => {
      await page.evaluate("document.fonts.ready.then(() => true)");
      await page.waitForNetworkIdle();
      const stylesheet = page.requestList().find((request) => request.url.startsWith(GOOGLE_FONTS_CSS));
      const fontFiles = page.requestList().filter((request) => request.url.startsWith(GOOGLE_FONTS_FILES));
      assertNoCspProblems(page);
      assert.ok(stylesheet, "the Material Symbols stylesheet was never requested");
      // A failure here is a network problem (CSP blocks were ruled out above).
      assert.equal(stylesheet.failure, null, `stylesheet not loaded (network): ${stylesheet.failure && describeFailure(stylesheet)}`);
      assert.equal(stylesheet.status, 200);
      assert.ok(fontFiles.length > 0, "no font file was requested from fonts.gstatic.com");
      for (const font of fontFiles) {
        assert.equal(font.failure, null, `font not loaded (network): ${font.failure && describeFailure(font)}`);
        assert.equal(font.status, 200, font.url);
      }

      const icons = await page.evaluate(`(() => {
        const faces = [...document.fonts].filter((face) => face.family.replaceAll('"', "") === ${JSON.stringify(MATERIAL_SYMBOLS_FAMILY)});
        const icon = document.querySelector(".material-symbols-outlined");
        const box = icon.getBoundingClientRect();
        return {
          statuses: faces.map((face) => face.status),
          text: icon.textContent,
          width: box.width,
          fontSize: parseFloat(getComputedStyle(icon).fontSize),
        };
      })()`);
      assert.ok(icons.statuses.includes("loaded"), `Material Symbols face not loaded: ${icons.statuses}`);
      // A ligature renders as one glyph about one em wide; without the font
      // the ligature name (e.g. "upload_file") would render as text.
      assert.ok(icons.width <= icons.fontSize * 1.5, `icon "${icons.text}" is ${icons.width}px wide at ${icons.fontSize}px: rendered as text`);
    });
  });
});

// ---------------------------------------------------------------------------
// F. Browser-visible headers and redirects
// ---------------------------------------------------------------------------

describe("F. headers and redirects as the browser sees them", () => {
  for (const path of ["/", "/login", "/upload", "/does-not-exist"]) {
    test(`${path} document and its static assets carry the security headers`, async () => {
      await withRoute(path, async (page) => {
        const document = onlyDocument(page);
        assertSecurityHeaders(document, path);
        const assets = page.requestList().filter((request) => new URL(request.url).pathname.startsWith("/_next/static/"));
        assert.ok(assets.length > 0, "no static assets loaded");
        for (const asset of assets) {
          assert.equal(asset.fromCache, false, `${asset.url} came from the cache`);
          assertSecurityHeaders(asset, asset.url);
        }
      }, { fresh: true });
    });
  }

  test("/login/ redirects once to /login, with headers on the redirect", async () => {
    await withRoute("/login/?next=%2Foverview", async (page) => {
      const document = onlyDocument(page);
      assert.equal(document.redirects.length, 1, `redirect chain: ${document.redirects.map((hop) => hop.url)}`);
      const [hop] = document.redirects;
      assert.equal(hop.status, 308);
      assertSecurityHeaders(hop, "/login/ redirect");
      assert.equal(document.url, `${web.origin}/login?next=%2Foverview`);
      assert.equal(document.status, 200);
      assertNoCspProblems(page);
    }, { fresh: true });
  });

  test("known limitation: Next's repeated-slash redirect stays on-site but has no app headers", async (t) => {
    await withRoute("//example.invalid", async (page) => {
      const document = onlyDocument(page);
      assert.equal(new URL(document.url).origin, web.origin, `left the app: ${document.url}`);
      assert.ok(document.redirects.length >= 1 && document.redirects.length <= 2, "redirect loop or none");
      for (const hop of document.redirects) {
        const missing = SECURITY_HEADER_NAMES.filter((name) => !hop.headers[name]);
        t.diagnostic(`${hop.status} ${hop.url} -> missing headers: ${missing.join(", ") || "none"}`);
      }
      assertSecurityHeaders(document, `${document.url} (final)`);
    }, { fresh: true });
  });
});
