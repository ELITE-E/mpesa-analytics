// The request rule for the app (CP8b, owner decision 2026-11-17): during an import the browser may
// only GET from the app's own origin, plus the HEAD that Next's link prefetch sends to one of the
// app's own pages, with no body. Anything else breaks the rule.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { app_pages, request_allowed } from "../../tools/browser/request_rule.js";

const ORIGIN = "http://127.0.0.1:4000";
const PAGES = new Set(["/", "/upload", "/ledger", "/breakdown/fees"]);
const scratch = mkdtempSync(join(tmpdir(), "request-rule-"));

after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A request as the tests record it.
 *
 * @param {string} method The method.
 * @param {string} url The URL.
 * @param {boolean} [hasBody] Whether it carries a body.
 * @returns {{method: string, url: string, hasBody: boolean}} The request.
 */
function request(method, url, hasBody = false) {
  return { method, url, hasBody };
}

test("a GET to the app's own origin is allowed, whatever the file", () => {
  assert.equal(
    request_allowed(request("GET", `${ORIGIN}/_next/static/chunks/a.js`), ORIGIN, PAGES),
    true,
  );
  assert.equal(
    request_allowed(request("GET", `${ORIGIN}/runtime/0000/pyodide.asm.wasm`), ORIGIN, PAGES),
    true,
  );
});

test("a HEAD to one of the app's own pages, with no body, is allowed (Next's prefetch)", () => {
  assert.equal(request_allowed(request("HEAD", `${ORIGIN}/ledger/`), ORIGIN, PAGES), true);
  assert.equal(request_allowed(request("HEAD", `${ORIGIN}/ledger/?import=1`), ORIGIN, PAGES), true);
});

test("a HEAD to anything that is not one of the app's pages breaks the rule", () => {
  assert.equal(
    request_allowed(request("HEAD", `${ORIGIN}/runtime/current.json`), ORIGIN, PAGES),
    false,
  );
  assert.equal(request_allowed(request("HEAD", `${ORIGIN}/not-a-page/`), ORIGIN, PAGES), false);
});

test("any request to another origin breaks the rule, GET and HEAD alike", () => {
  assert.equal(
    request_allowed(request("GET", "https://example.invalid/a.js"), ORIGIN, PAGES),
    false,
  );
  assert.equal(
    request_allowed(request("HEAD", "https://example.invalid/ledger/"), ORIGIN, PAGES),
    false,
  );
  assert.equal(request_allowed(request("GET", "http://127.0.0.1:4001/"), ORIGIN, PAGES), false);
});

test("a request that can carry data out breaks the rule, even to the app's own pages", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(
      request_allowed(request(method, `${ORIGIN}/ledger/`), ORIGIN, PAGES),
      false,
      method,
    );
  }
  assert.equal(request_allowed(request("HEAD", `${ORIGIN}/ledger/`, true), ORIGIN, PAGES), false);
  assert.equal(request_allowed(request("GET", `${ORIGIN}/ledger/`, true), ORIGIN, PAGES), false);
});

test("the app's pages are the static export's HTML pages, by their routes", () => {
  for (const folder of ["breakdown", "_next/static", "runtime/0000"]) {
    mkdirSync(join(scratch, folder), { recursive: true });
  }
  for (const file of [
    "index.html",
    "upload.html",
    "404.html",
    "breakdown.html",
    "breakdown/fees.html",
  ]) {
    writeFileSync(join(scratch, file), "");
  }
  writeFileSync(join(scratch, "runtime", "0000", "page.html"), "");
  writeFileSync(join(scratch, "_next", "static", "chunk.html"), "");
  assert.deepEqual([...app_pages(scratch)].sort(), [
    "/",
    "/breakdown",
    "/breakdown/fees",
    "/upload",
  ]);
});

test("a HEAD to a page's address with a trailing slash still names that page", () => {
  assert.equal(
    request_allowed(request("HEAD", `${ORIGIN}/upload/`), ORIGIN, new Set(["/upload"])),
    true,
  );
});
