#!/usr/bin/env node
// Runs one statement through the browser engine in headless Chrome, for the owner's equivalence
// check on their own machine, and writes the browser's statement pages and pipeline result to an
// owner-only folder outside the repo. Prints counts only. If the PDF needs a password, it asks
// with a hidden prompt. The account digest is never written, only whether one was read.
//   node tools/equivalence/browser_run.mjs --pdf <pdf> --out <new folder outside the repo>
// Then: python tools/equivalence/compare.py --browser-result <folder> --baseline <file> --share
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { DESKTOP_LIMITS } from "../../pdf_reader/limits.js";
import { open_session, other_requests, run_in_browser } from "../browser/browser_session.js";
import { serialize_statement_pages } from "../pdf_readers/fixture_reader.js";
import {
  is_inside_repo,
  make_owner_only_directory,
  write_owner_only,
} from "../pdf_readers/owner_output.js";
import { ask_for_password } from "../pdf_readers/password_prompt.js";

const CANNOT_RUN = 2;
const NO_LIMIT = Number.MAX_SAFE_INTEGER;
// An equivalence check measures a whole statement, so the app's limits do not apply; whether
// they would have accepted it is printed instead.
const CHECK_LIMITS = { byteLimit: NO_LIMIT, pageLimit: NO_LIMIT };
const CHECK_TIMEOUT_MS = 30 * 60 * 1000;
const PROCESSED_AT = null;

process.exit(await main());

/**
 * Run the statement named on the command line through the browser engine.
 *
 * Side effects: reads the PDF, may prompt, starts a loopback server and Chrome, creates the
 * output folder and writes two owner-only files, and prints counts.
 *
 * @returns {Promise<number>} Process exit code: 0 on success, 2 on any failure.
 */
async function main() {
  const request = parse_request();
  if (request === null) return refuse("expected --pdf <pdf> --out <dir> and nothing else");
  if (is_inside_repo(request.outDir)) return refuse("--out must be outside the repo");
  let pdfBytes;
  try {
    pdfBytes = new Uint8Array(readFileSync(request.pdfPath));
    make_owner_only_directory(request.outDir);
  } catch (error) {
    return refuse(
      error?.code === "EEXIST" ? "--out exists: remove the old --out folder first" : "CANNOT_READ",
    );
  }
  const session = await open_session();
  try {
    if (!session.ready.ok) return refuse(session.ready.failure.code);
    const outcome = await run_with_prompt(session, pdfBytes);
    if (!outcome.ok) return refuse(outcome.failure.code);
    write_outputs(request.outDir, outcome);
    print_counts(session, pdfBytes, outcome);
    return 0;
  } finally {
    await session.close();
  }
}

/**
 * Read the command line. Unknown options are refused, so a password cannot be passed by mistake.
 *
 * Side effects: none.
 *
 * @returns {{pdfPath: string, outDir: string}|null} The request, or null if it is malformed.
 */
function parse_request() {
  try {
    const { values, positionals } = parseArgs({
      options: { pdf: { type: "string" }, out: { type: "string" } },
      allowPositionals: false,
    });
    if (positionals.length !== 0 || !values.pdf || !values.out) return null;
    return { pdfPath: values.pdf, outDir: values.out };
  } catch {
    return null;
  }
}

/**
 * Print a failure: a code or fixed text, never anything from the statement or a path.
 *
 * Side effects: writes one line to stdout.
 *
 * @param {string} reason The code or fixed text.
 * @returns {number} The failure exit code.
 */
function refuse(reason) {
  process.stdout.write(`browser_run: ERROR (${reason})\n`);
  return CANNOT_RUN;
}

/**
 * Run the statement, asking for a password only if the PDF needs one.
 *
 * Side effects: runs the engine, and may prompt for and read a password.
 *
 * @param {object} session The browser session.
 * @param {Uint8Array} pdfBytes The PDF.
 * @returns {Promise<object>} The engine's outcome.
 */
async function run_with_prompt(session, pdfBytes) {
  const options = {
    limits: CHECK_LIMITS,
    timeout_ms: CHECK_TIMEOUT_MS,
    include_statement_pages: true,
    processed_at: PROCESSED_AT,
  };
  const first = await run_in_browser(session, pdfBytes, options);
  if (first.ok || first.failure.code !== "PASSWORD_REQUIRED") return first;
  return run_in_browser(session, pdfBytes, { ...options, password: await ask_for_password() });
}

/**
 * Write the statement pages and the pipeline result, without the account digest.
 *
 * Side effects: writes pages.json and result.json, each readable by the owner only.
 *
 * @param {string} outDir The owner-only output folder.
 * @param {object} outcome The engine's successful outcome.
 */
function write_outputs(outDir, outcome) {
  const statementPages = JSON.parse(outcome.statement_pages_json);
  const { account_digest: accountDigest, ...pipelineResult } = JSON.parse(
    outcome.pipeline_result_json,
  );
  const browserResult = {
    processed_at: PROCESSED_AT,
    pipeline_result: pipelineResult,
    account_digest_present: accountDigest !== null && accountDigest !== undefined,
  };
  write_owner_only(join(outDir, "pages.json"), serialize_statement_pages(statementPages));
  write_owner_only(join(outDir, "result.json"), `${JSON.stringify(browserResult)}\n`);
}

/**
 * Write a timing as whole milliseconds.
 *
 * Side effects: none.
 *
 * @param {number|null|undefined} value Milliseconds, if measured.
 * @returns {string} The rounded number, or "none".
 */
function rounded(value) {
  return value == null ? "none" : String(Math.round(value));
}

/**
 * Write a yes or no answer.
 *
 * Side effects: none.
 *
 * @param {boolean} answer The answer.
 * @returns {string} "yes" or "no".
 */
function yes(answer) {
  return answer ? "yes" : "no";
}

/**
 * Print fixed labels and counts.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} session The browser session.
 * @param {Uint8Array} pdfBytes The PDF.
 * @param {object} outcome The engine's successful outcome.
 */
function print_counts(session, pdfBytes, outcome) {
  const pages = JSON.parse(outcome.statement_pages_json).pages;
  const pipelineResult = JSON.parse(outcome.pipeline_result_json);
  const items = pages.reduce((total, page) => total + page.items.length, 0);
  const lines = [
    "browser_run: PASS",
    `pages: ${pages.length}`,
    `items: ${items}`,
    `transactions: ${pipelineResult.transactions.length}`,
    `pdf_bytes: ${pdfBytes.length}`,
    `within_desktop_byte_limit: ${yes(pdfBytes.length <= DESKTOP_LIMITS.byteLimit)}`,
    `within_desktop_page_limit: ${yes(pages.length <= DESKTOP_LIMITS.pageLimit)}`,
    `account_digest_read: ${yes(pipelineResult.account_digest != null)}`,
    `runtime_load_ms: ${rounded(session.ready.timings.runtime_load_ms)}`,
    `read_ms: ${rounded(outcome.timings.read_ms)}`,
    `core_ms: ${rounded(outcome.timings.core_ms)}`,
    `pandas_load_ms: ${rounded(outcome.timings.pandas_load_ms)}`,
    `within_desktop_timeout: ${yes(outcome.timings.read_ms + outcome.timings.core_ms <= DESKTOP_LIMITS.timeoutMs)}`,
    `csp_violations: ${outcome.timings.csp_violations}`,
    `other_requests: ${other_requests(session).length}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
