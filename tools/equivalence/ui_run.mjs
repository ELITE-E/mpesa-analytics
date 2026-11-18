#!/usr/bin/env node
// CP8b item 9: drives the real UI with one statement, for the owner's check on their own machine.
// Serves the built app (web/out) with its CSP, chooses the PDF on /upload in headless Chrome as a
// user would, and follows the app's own links to the Ledger and Overview. Prints counts only:
// the transactions the Ledger shows, whether the frontend's compareWithApi agrees (Overview shows
// no "unverified" breakdown), CSP violations, and requests that break the request rule
// (tools/browser/request_rule.js: GETs to the app's origin, and prefetch HEADs to its pages). Writes nothing; the browser's profile
// is a temporary one Chrome deletes on close. If the PDF needs a password, it asks with a hidden
// prompt; the password goes only to the app's password field.
//   node tools/equivalence/ui_run.mjs --pdf <pdf>
// With --remember (CP9c), it turns "Remember on this device" on in the throwaway profile with a
// random passphrase it never prints, reads the statement twice through the merge screen, saves
// both, and prints the merge counts: the first import's inserted rows, and the second import's
// matched, inserted and collided rows. The profile, with its saved data, is deleted on close.
//   node tools/equivalence/ui_run.mjs --pdf <pdf> --remember
// Needs the runtime and the app built: tools/vendor.py runtime, then npm run build in web/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

import { start_static_server } from "../../web/scripts/serve_static.mjs";
import { chrome_path } from "../browser/browser_session.js";
import { app_pages, request_allowed } from "../browser/request_rule.js";
import { randomBytes } from "node:crypto";

import {
  follow,
  import_statement,
  read_to_merge,
  save_merge,
  turn_on_remember,
} from "../browser/ui_journey.js";
import { ask_for_password } from "../pdf_readers/password_prompt.js";

const CANNOT_RUN = 2;
const APP = join(import.meta.dirname, "../../web/out");
// A real statement on a slow laptop: cold Pyodide and pandas, then every page.
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;
const PAGE_TIMEOUT_MS = 120_000;
const OVERVIEW_READY = "Where it went";
const LEDGER_COUNT = /Export (\d+) rows/;

process.exit(await main());

/**
 * Drive the real UI with the statement named on the command line.
 *
 * Side effects: reads the PDF, may prompt, starts a loopback server and Chrome, prints counts.
 *
 * @returns {Promise<number>} Process exit code: 0 when the UI read the statement, 2 otherwise.
 */
async function main() {
  const request = parse_request();
  if (request === null)
    return refuse("expected --pdf <pdf>, optionally --remember, and nothing else");
  const { pdfPath, remember } = request;
  if (!existsSync(join(APP, "index.html"))) return refuse("APP_NOT_BUILT");
  let pdfBytes;
  try {
    pdfBytes = readFileSync(pdfPath);
  } catch {
    return refuse("CANNOT_READ");
  }
  const server = await start_static_server();
  const browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
  try {
    const app = await open_app(browser);
    const timeouts = { importTimeoutMs: IMPORT_TIMEOUT_MS, pageTimeoutMs: PAGE_TIMEOUT_MS };
    if (remember) return await remember_twice(app, server, pdfBytes, timeouts);
    return await read_once(app, server, pdfBytes, timeouts);
  } catch (error) {
    // A timeout or a page that never showed its data: the error's name only, never its text.
    return refuse(error?.name ?? "FAILED");
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Read the statement once in the session, then count what the Ledger and Overview show.
 *
 * Side effects: drives the page; may prompt; prints counts.
 *
 * @param {object} app From open_app.
 * @param {object} server The static server.
 * @param {Buffer} pdfBytes The PDF.
 * @param {object} timeouts `importTimeoutMs` and `pageTimeoutMs`.
 * @returns {Promise<number>} Process exit code: 0 when the UI read the statement, 2 otherwise.
 */
async function read_once(app, server, pdfBytes, timeouts) {
  let landing = await import_statement(app.page, server.origin, pdfBytes, timeouts);
  if (landing.code === "PASSWORD_REQUIRED") {
    const password = await ask_for_password();
    landing = await import_statement(app.page, server.origin, pdfBytes, {
      ...timeouts,
      password,
    });
  }
  if (landing.code !== null) return refuse(landing.code);
  const transactions = await ledger_count(app.page);
  const unverified = await overview_unverified(app.page);
  await print_counts(app, server, [
    `transactions_shown: ${transactions}`,
    `compare_with_api: ${unverified === 0 ? "pass" : "fail"}`,
    `overview_breakdowns_unverified: ${unverified}`,
  ]);
  return 0;
}

/**
 * Read the command line. Unknown options are refused, so a password cannot be passed by mistake.
 *
 * Side effects: none.
 *
 * @returns {{pdfPath: string, remember: boolean}|null} The PDF's path and whether to remember it,
 *   or null if the command line is malformed.
 */
function parse_request() {
  try {
    const { values, positionals } = parseArgs({
      options: { pdf: { type: "string" }, remember: { type: "boolean" } },
      allowPositionals: false,
    });
    if (positionals.length !== 0 || !values.pdf) return null;
    return { pdfPath: values.pdf, remember: values.remember === true };
  } catch {
    return null;
  }
}

/**
 * Turn remembering on, read the statement twice through the merge screen, save both, and print
 * the counts. A password, if the PDF needs one, is asked for once at the hidden prompt.
 *
 * Side effects: drives the page; may prompt; prints counts.
 *
 * @param {object} app From open_app.
 * @param {object} server The static server.
 * @param {Buffer} pdfBytes The PDF.
 * @param {object} timeouts `importTimeoutMs` and `pageTimeoutMs`.
 * @returns {Promise<number>} Process exit code: 0 when both imports were saved, 2 otherwise.
 */
async function remember_twice(app, server, pdfBytes, timeouts) {
  // Random and never printed; the profile holding the saved data is deleted on close.
  const passphrase = randomBytes(24).toString("base64url");
  await turn_on_remember(app.page, server.origin, passphrase, timeouts.pageTimeoutMs);
  const options = { ...timeouts };
  let landing = await read_to_merge(app.page, pdfBytes, options);
  if (landing.code === "PASSWORD_REQUIRED") {
    options.password = await ask_for_password();
    landing = await read_to_merge(app.page, pdfBytes, options);
  }
  if (landing.code !== null) return refuse(landing.code);
  const first = await save_merge(app.page, timeouts.pageTimeoutMs);
  landing = await read_to_merge(app.page, pdfBytes, options);
  if (landing.code !== null) return refuse(landing.code);
  const second = await save_merge(app.page, timeouts.pageTimeoutMs);
  const counts = [
    "remember: on",
    `first_import_inserted: ${first.inserted}`,
    `second_import_matched: ${second.matched}`,
    `second_import_inserted: ${second.inserted}`,
    `second_import_collided: ${second.collided}`,
  ];
  await print_counts(app, server, counts);
  return 0;
}

/**
 * Print the failure and give the failure exit code.
 *
 * Side effects: writes one line to stdout.
 *
 * @param {string} reason A code or fixed text, never a statement value.
 * @returns {number} The failure exit code.
 */
function refuse(reason) {
  process.stdout.write(`ui_run: ERROR (${reason})\n`);
  return CANNOT_RUN;
}

/**
 * Open a tab that records requests, CSP violations and CSP console reports, never their text.
 *
 * Side effects: opens a browser context and page.
 *
 * @param {object} browser The browser.
 * @returns {Promise<object>} The page and its records.
 */
async function open_app(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const records = { requests: [], cspConsole: 0 };
  context.on("request", (request) =>
    records.requests.push({
      url: request.url(),
      method: request.method(),
      hasBody: request.postData() !== null,
    }),
  );
  await context.addInitScript(() => {
    window.__cspViolations = 0;
    document.addEventListener("securitypolicyviolation", () => {
      window.__cspViolations += 1;
    });
  });
  const page = await context.newPage();
  /**
   * Count a console line that reports a CSP violation; its text is never kept.
   *
   * @param {object} message The console message.
   */
  const count_csp = (message) => {
    if (/Content Security Policy/i.test(message.text())) records.cspConsole += 1;
  };
  page.on("console", count_csp);
  page.on("worker", (worker) => worker.on("console", count_csp));
  return { page, records };
}

/**
 * How many transactions the Ledger shows: its export button counts every row in view.
 *
 * Side effects: drives the page.
 *
 * @param {object} page The page.
 * @returns {Promise<number>} The count.
 */
async function ledger_count(page) {
  await follow(page, "/ledger");
  const button = page.getByText(LEDGER_COUNT).filter({ visible: true }).first();
  await button.waitFor({ timeout: PAGE_TIMEOUT_MS });
  return Number((await button.innerText()).match(LEDGER_COUNT)[1]);
}

/**
 * How many Overview breakdowns are withheld because the rows' inflow, outflow or charges disagree
 * with the report's (the frontend's compareWithApi).
 *
 * Side effects: drives the page.
 *
 * @param {object} page The page.
 * @returns {Promise<number>} 0 when compareWithApi agrees on all three totals.
 */
async function overview_unverified(page) {
  await follow(page, "/overview");
  await page
    .getByText(OVERVIEW_READY)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: PAGE_TIMEOUT_MS });
  return page.locator("[data-unverified]").count();
}

/**
 * Print the counts: the run's own, then CSP violations and requests that break the rule.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} app From open_app.
 * @param {object} server The static server.
 * @param {string[]} runCounts The run's count lines.
 */
async function print_counts(app, server, runCounts) {
  const violations = await app.page.evaluate(() => window.__cspViolations ?? 0);
  const requests = app.records.requests;
  const lines = [
    "ui_run: PASS",
    ...runCounts,
    `csp_violations: ${violations}`,
    `csp_console_reports: ${app.records.cspConsole}`,
    `requests_other_origin: ${requests.filter((request) => !request.url.startsWith(`${server.origin}/`)).length}`,
    `requests_breaking_rule: ${requests.filter((request) => !request_allowed(request, server.origin, app_pages(APP))).length}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
