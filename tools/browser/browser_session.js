// Shared by the real-Chrome tests, the limits measurement and the owner's browser equivalence run: serves the harness
// with the architecture CSP, drives system Chrome through Playwright and records every request.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

import { start_harness_server } from "../../web/harness/serve.js";

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
];

/**
 * Find the system Chrome. CHROME_BIN wins; no browser is ever downloaded.
 *
 * Side effects: reads the environment and the filesystem.
 *
 * @returns {string} Path of the Chrome executable.
 * @throws {Error} If no Chrome is installed.
 */
export function chrome_path() {
  const found = [process.env.CHROME_BIN, ...CHROME_CANDIDATES].find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!found) throw new Error("Chrome not found; set CHROME_BIN");
  return found;
}

/**
 * Serve the harness, open it in headless Chrome and wait for the engine to load.
 *
 * Side effects: starts a loopback server and a Chrome process.
 *
 * @param {object} [options] Session options.
 * @param {string} [options.csp] Content-Security-Policy for the server; the architecture's by
 *   default.
 * @param {boolean} [options.wait_ready] Wait for the engine's runtime to load (default true).
 * @param {string} [options.corrupt_runtime_file] Serve this runtime file with one byte changed.
 * @param {string} [options.harness_page] The harness page to open, under /harness/ (the engine harness by
 *   default).
 * @returns {Promise<object>} The session: page, origin, requests, console lines and close().
 */
export async function open_session({
  csp,
  wait_ready = true,
  corrupt_runtime_file,
  harness_page = "",
} = {}) {
  const server = await start_harness_server({ csp, corrupt_runtime_file });
  const browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
  const context = await browser.newContext();
  const session = {
    origin: server.origin,
    requests: [],
    console_lines: [],
    page: null,
    async close() {
      await browser.close();
      await server.close();
    },
  };
  context.on("request", (request) => session.requests.push(describe_request(request)));
  const page = await context.newPage();
  page.on("console", (message) => session.console_lines.push(message.text()));
  page.on("worker", (worker) =>
    worker.on("console", (message) => session.console_lines.push(message.text())),
  );
  session.page = page;
  await page.goto(`${server.origin}/harness/${harness_page}`);
  if (wait_ready) session.ready = await page.evaluate(() => window.harness.ready());
  return session;
}

/**
 * Run one PDF through the browser engine.
 *
 * Side effects: sends the PDF's bytes to the page, which runs the engine.
 *
 * @param {object} session An open session.
 * @param {Uint8Array} pdfBytes The PDF's bytes.
 * @param {object} [options] Run options: password, limits, include_statement_pages,
 *   processed_at.
 * @returns {Promise<object>} The engine's outcome, as the harness returns it.
 */
export async function run_in_browser(session, pdfBytes, options = {}) {
  const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
  return session.page.evaluate(
    ({ pdf_base64, run_options }) => window.harness.run_statement(pdf_base64, run_options),
    { pdf_base64: pdfBase64, run_options: options },
  );
}

/**
 * Requests that are not same-origin static GETs.
 *
 * Side effects: none.
 *
 * @param {object} session An open session.
 * @returns {object[]} Every other request seen.
 */
export function other_requests(session) {
  return session.requests.filter(
    (request) =>
      !(request.method === "GET" && request.url.startsWith(`${session.origin}/`)) ||
      !["/harness/", "/pdf_reader/", "/runtime/"].some((prefix) =>
        request.url.startsWith(`${session.origin}${prefix}`),
      ),
  );
}

/**
 * Run the core under CPython on statement pages, through the same bridge call the browser uses.
 *
 * Side effects: starts one Python process.
 *
 * @param {object[]} requests Each `{statement_pages_json, processed_at}`.
 * @returns {object[]} Each run_json envelope, parsed.
 * @throws {Error} If Python fails.
 */
export function run_in_cpython(requests) {
  const repo = join(import.meta.dirname, "../..");
  const python = existsSync(join(repo, ".venv/bin/python"))
    ? join(repo, ".venv/bin/python")
    : "python";
  const ran = spawnSync(python, [join(import.meta.dirname, "cpython_run.py")], {
    input: JSON.stringify(requests),
    maxBuffer: 1024 ** 3,
    encoding: "utf8",
    cwd: repo,
  });
  if (ran.status !== 0) throw new Error(`cpython_run failed with status ${ran.status}`);
  return JSON.parse(ran.stdout);
}

/**
 * Read a committed synthetic fixture.
 *
 * Side effects: reads the file.
 *
 * @param {string} name Fixture name.
 * @returns {Uint8Array} The PDF's bytes.
 */
export function fixture_pdf(name) {
  const path = join(import.meta.dirname, "../../tests/fixtures/synthetic", `${name}.pdf`);
  return new Uint8Array(readFileSync(path));
}

/**
 * Keep what a test needs to know about one request: no body, no headers.
 *
 * Side effects: none.
 *
 * @param {object} request A Playwright request.
 * @returns {{method: string, url: string}} Its method and URL.
 */
function describe_request(request) {
  return { method: request.method(), url: request.url() };
}
