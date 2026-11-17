#!/usr/bin/env node
// CP8b item 7, the honest measure: what a first visit really downloads from the app. Serves the
// built app (web/out) with its CSP, then in headless Chrome opens it fresh, goes to /upload,
// reads one synthetic statement through the real UI and opens every page through the app's own
// links. Prints the JSON list of every same-origin path the browser downloaded (a successful
// response), each once, sorted. tools/measure_bundle.py --fetched counts only those files.
//   node tools/measure_app_download.mjs > fetched.json
// Needs the runtime and the app built: tools/vendor.py runtime, then npm run build in web/.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

import { start_static_server } from "../web/scripts/serve_static.mjs";
import { chrome_path } from "./browser/browser_session.js";
import { follow, import_statement } from "./browser/ui_journey.js";

const STATEMENT = join(import.meta.dirname, "../tests/fixtures/synthetic/F-GOLDEN.pdf");
const TIMEOUTS = { importTimeoutMs: 600_000, pageTimeoutMs: 120_000 };
const OK_STATUSES = new Set([200, 304]);
const CANNOT_RUN = 2;
const AREAS = ["spending", "people", "savings", "fees", "cash", "money-in"];

process.exit(await main());

/**
 * Record a full visit and print the paths it downloaded.
 *
 * Side effects: starts a loopback server and Chrome; writes the list to stdout.
 *
 * @returns {Promise<number>} Process exit code: 0, or 2 if the visit did not complete.
 */
async function main() {
  const server = await start_static_server();
  const browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const fetched = new Set();
    context.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === server.origin && OK_STATUSES.has(response.status()))
        fetched.add(url.pathname);
    });
    const page = await context.newPage();
    await page.goto(`${server.origin}/`);
    const landing = await import_statement(page, server.origin, readFileSync(STATEMENT), TIMEOUTS);
    if (landing.code !== null) return refuse(landing.code);
    await visit_every_page(page);
    // Let prefetches started by the last page finish, as a user who stays on it would.
    await page.waitForLoadState("networkidle");
    process.stdout.write(`${JSON.stringify([...fetched].sort(), null, 2)}\n`);
    return 0;
  } catch (error) {
    return refuse(error?.name ?? "FAILED");
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Open Overview, the Ledger, the Breakdown hub and each of its areas through the app's links.
 *
 * Side effects: drives the page.
 *
 * @param {object} page The page, on the analysis summary.
 */
async function visit_every_page(page) {
  for (const route of ["/overview", "/ledger", "/breakdown"]) {
    await follow(page, route);
    await page.waitForLoadState("networkidle");
  }
  for (const area of AREAS) {
    await follow(page, `/breakdown/${area}`);
    await page.waitForLoadState("networkidle");
    await follow(page, "/breakdown");
  }
}

/**
 * Print why the visit did not complete and give the failure exit code.
 *
 * Side effects: writes one line to stderr.
 *
 * @param {string} reason A code, never a statement value.
 * @returns {number} The failure exit code.
 */
function refuse(reason) {
  process.stderr.write(`measure_app_download: ERROR (${reason})\n`);
  return CANNOT_RUN;
}
