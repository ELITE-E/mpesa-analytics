// Preservation contract M4 (Stage 0A of the IA migration): the recovery
// screen offers "Try Again" only when the failed upload can succeed unchanged,
// i.e. a retryable failure with the file still in this tab's memory; a
// non-retryable failure offers only "Choose Another Statement".
//
// Real headless Chrome (support/cdp-browser.mjs) drives the real UI from
// /upload through /processing to /recovery on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) that fails every upload as each test asks.
// The file uploaded is a synthetic PDF-like file written to a temp dir.
// Recovery state is client-only (useSyncExternalStore with a false server
// snapshot), which is why this needs a browser rather than renderToString.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts.
// FRONTEND_SECURITY_APP_DIR may name another app directory to build.
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/recovery-retry-browser.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { launchBrowser } from "./support/cdp-browser.mjs";
import { apiError, json, startFakeApi } from "./support/fake-api.mjs";
import {
  buildForProduction,
  copyAppToTempDir,
  removeTempDir,
  startProductionServer,
} from "./support/frontend-server.mjs";

const PROCEED_LABEL = "Proceed to Analysis";
const RETRY_LABEL = "Try Again";
const CHOOSE_ANOTHER_LABEL = "Choose Another Statement";
const SLOW_STEP_MS = 120_000;

/** The failure the fake API returns for the next upload. */
let nextUploadFailure = null;

let api;
let appDir;
let web;
let browser;
let fileDir;
let syntheticPdf;

before(async () => {
  fileDir = mkdtempSync(join(tmpdir(), "recovery-retry-"));
  syntheticPdf = join(fileDir, "synthetic-statement.pdf");
  writeFileSync(syntheticPdf, "%PDF-1.4\n% synthetic test file, not a statement\n");
  api = await startFakeApi(({ method, path }) =>
    method === "POST" && path === "/api/v1/imports"
      ? apiError(nextUploadFailure.status, nextUploadFailure.code)
      : json(404, { error: { code: "not_found", message: "Not found." } }),
  );
  appDir = copyAppToTempDir();
  await buildForProduction(appDir, api.origin);
  web = await startProductionServer(appDir);
  browser = await launchBrowser();
}, { timeout: 600_000 });

after(async () => {
  await browser?.close();
  await web?.stop();
  removeTempDir(appDir);
  api?.close();
  if (fileDir) rmSync(fileDir, { recursive: true, force: true });
});

/** A JS expression: whether a visible button or link shows `label`. */
function visibleControl(label) {
  return `[...document.querySelectorAll("button, a")].some((el) => el.textContent.includes(${JSON.stringify(label)}) && el.getBoundingClientRect().height > 0)`;
}

/** Upload the synthetic file through the real UI and land on /recovery. */
async function failAnUpload(failure) {
  nextUploadFailure = failure;
  const page = await browser.newPage();
  await page.goto(`${web.origin}/upload`);
  await page.waitFor(`!!document.querySelector('input[type="file"]')`, "the file input", SLOW_STEP_MS);
  const { root } = await page.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
  await page.send("DOM.setFileInputFiles", { nodeId, files: [syntheticPdf] });
  const proceed = `[...document.querySelectorAll("button")].find((b) => b.textContent.includes(${JSON.stringify(PROCEED_LABEL)}))`;
  await page.waitFor(`${proceed} && !${proceed}.disabled`, "an enabled Proceed button");
  await page.evaluate(`${proceed}.click()`);
  await page.waitFor(
    `location.pathname === "/recovery" && document.body.innerText.includes(${JSON.stringify(failure.code)})`,
    "the recovery screen showing the failure code",
    SLOW_STEP_MS,
  );
  return page;
}

describe("M4 recovery retry visibility", () => {
  test("a retryable failure (503 server_busy) offers Try Again", async () => {
    const page = await failAnUpload({ status: 503, code: "server_busy" });

    assert.equal(await page.evaluate(visibleControl(RETRY_LABEL)), true, "Try Again must be offered");
    assert.equal(await page.evaluate(visibleControl(CHOOSE_ANOTHER_LABEL)), true);
  }, { timeout: 300_000 });

  test("a non-retryable failure (422 statement_password_invalid) does not offer Try Again", async () => {
    const page = await failAnUpload({ status: 422, code: "statement_password_invalid" });

    assert.equal(await page.evaluate(visibleControl(RETRY_LABEL)), false, "Try Again must not be offered");
    assert.equal(await page.evaluate(visibleControl(CHOOSE_ANOTHER_LABEL)), true);
  }, { timeout: 300_000 });
});
