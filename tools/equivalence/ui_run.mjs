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
// Needs the runtime and the app built: tools/vendor.py runtime, then npm run build in web/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

import { start_static_server } from "../../web/scripts/serve_static.mjs";
import { chrome_path } from "../browser/browser_session.js";
import { app_pages, request_allowed } from "../browser/request_rule.js";
import { follow, import_statement } from "../browser/ui_journey.js";
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
  const pdfPath = parse_request();
  if (pdfPath === null) return refuse("expected --pdf <pdf> and nothing else");
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
    await print_counts(app, server, transactions, unverified);
    return 0;
  } catch (error) {
    // A timeout or a page that never showed its data: the error's name only, never its text.
    return refuse(error?.name ?? "FAILED");
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Read the command line. Unknown options are refused, so a password cannot be passed by mistake.
 *
 * Side effects: none.
 *
 * @returns {string|null} The PDF's path, or null if the command line is malformed.
 */
function parse_request() {
  try {
    const { values, positionals } = parseArgs({
      options: { pdf: { type: "string" } },
      allowPositionals: false,
    });
    return positionals.length === 0 && values.pdf ? values.pdf : null;
  } catch {
    return null;
  }
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
 * Print the counts.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} app From open_app.
 * @param {object} server The static server.
 * @param {number} transactions The Ledger's count.
 * @param {number} unverified Withheld Overview breakdowns.
 */
async function print_counts(app, server, transactions, unverified) {
  const violations = await app.page.evaluate(() => window.__cspViolations ?? 0);
  const requests = app.records.requests;
  const lines = [
    "ui_run: PASS",
    `transactions_shown: ${transactions}`,
    `compare_with_api: ${unverified === 0 ? "pass" : "fail"}`,
    `overview_breakdowns_unverified: ${unverified}`,
    `csp_violations: ${violations}`,
    `csp_console_reports: ${app.records.cspConsole}`,
    `requests_other_origin: ${requests.filter((request) => !request.url.startsWith(`${server.origin}/`)).length}`,
    `requests_breaking_rule: ${requests.filter((request) => !request_allowed(request, server.origin, app_pages(APP))).length}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
