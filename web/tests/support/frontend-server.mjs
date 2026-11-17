// Runs the app for the prototype's browser tests. CP8b swapped the server: the app is now the
// static export (web/out, built by `npm run build`), served with its CSP by scripts/serve_static.mjs,
// so nothing is copied or built here and the function names stay for the tests that call them.
//
// The app holds statements in memory only, read by its engine, so a test's data reaches it through
// an upload, as a user's would: openWithImport chooses a stand-in statement on /upload naming the
// import the route asks for, and the engine's worker is swapped for a stand-in that reads that
// import from the test's fake API (support/fake-api.mjs), through this same origin so the CSP holds.
// The app then moves to the route with its own router, keeping the session. Any other file a test
// uploads is posted to the fake API's upload, and its error answers become the engine's failures.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start_static_server } from "../../scripts/serve_static.mjs";

const OUT = join(import.meta.dirname, "../../out");
const WORKER_PATH = "/pdf_reader/reader.worker.js";
const TEST_API_PREFIX = "/__test_api__";
const IMPORT_MARKER = "import:";
const SLOW_STEP_MS = 120_000;
// The screens that show a statement; the others (the start, /upload, /processing, /recovery) open
// as they are, with nothing read in.
const STATEMENT_SCREENS = /^\/(overview|ledger|breakdown|analysis-summary)(\/|$)/;
const apiOrigins = new Map();
const statementFiles = mkdtempSync(join(tmpdir(), "stand-in-statements-"));

// The stand-in engine worker: it speaks the real worker's messages, and for a run reads the import
// the uploaded file names from the fake API, then answers with it as the core's pipeline result.
const STAND_IN_WORKER = `
const PREFIX = "${TEST_API_PREFIX}";
const MARKER = "${IMPORT_MARKER}";
const NO_ENTITY = "NO_ENTITY_IDENTIFIED";
async function read(path) {
  const response = await fetch(PREFIX + path);
  if (!response.ok) throw new Error("unavailable");
  return response.json();
}
function core_row(row) {
  return {
    receipt_no: row.receipt_no, completion_time: row.completion_time, details: row.details,
    status: row.transaction_status, paid_in: row.paid_in, withdrawn: row.paid_out,
    paid_out: row.paid_out, balance: row.balance, event_type: row.event_type,
    cash_flow_direction: row.cash_flow_direction, economic_meaning: row.economic_meaning,
    total_cost: row.total_cost, entity: row.entity === NO_ENTITY ? null : row.entity,
  };
}
async function pipeline_result(importId, token) {
  const base = "/api/v1/imports/" + importId;
  const summary = await read(base);
  const snapshot = await read(base + "/analytics");
  const page = await read(base + "/transactions?limit=1000000&offset=0");
  const rows = page.items;
  const unclassified = rows.filter((row) => row.event_type === "UNCLASSIFIED").length;
  return {
    schema_version: 1, verification_token: token ?? "QX7" + "M2KP9", verification_instruction: null,
    account_digest: null, processed_at: summary.imported_at,
    period: { start: summary.period_start, end: summary.period_end },
    balances: { opening_balance: null, closing_balance: rows.length ? rows[rows.length - 1].balance : null },
    transactions: [...rows].reverse().map(core_row),
    report: snapshot.result,
    quality: {
      row_count: rows.length, chain_breaks: 0, summary_total_paid_in_matches: true,
      summary_total_paid_out_matches: true, unclassified_rows: unclassified,
      unclassified_share: rows.length ? unclassified / rows.length : 0,
    },
    diagnostics: [],
  };
}
function failure_for(status, code) {
  if (status >= 500) return { code: "ENGINE_FAILED", stage: "engine" };
  if (code === "statement_password_invalid") return { code: "PASSWORD_INCORRECT", stage: "reader" };
  if (code === "statement_password_required") return { code: "PASSWORD_REQUIRED", stage: "reader" };
  return { code: "LAYOUT_UNRECOGNIZED", stage: "core" };
}
self.onmessage = async ({ data: message }) => {
  if (message.type === "start") self.postMessage({ type: "ready", timings: {} });
  if (message.type === "warm_up") self.postMessage({ type: "warmed", timings: {} });
  if (message.type !== "run") return;
  const done = (outcome) => self.postMessage({ type: "run_done", request_id: message.request_id, ...outcome, timings: {} });
  try {
    const text = new TextDecoder().decode(message.pdf_bytes);
    let importId = Number(text.slice(MARKER.length));
    let token = null;
    if (!text.startsWith(MARKER)) {
      // Any other file is posted to the fake API's upload, as the old app did; its error answers
      // become the engine's failures, so the recovery screen meets the same cases.
      const response = await fetch(PREFIX + "/api/v1/imports", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return done({ ok: false, failure: failure_for(response.status, body.error?.code) });
      importId = body.import.id;
      token = body.verification_token ?? null;
    }
    const result = await pipeline_result(importId, token);
    const plan = { actions: [], counts: { new: result.transactions.length, matched: 0, collided: 0 } };
    done({ ok: true, pipeline_result_json: JSON.stringify(result), plan_json: JSON.stringify(plan) });
  } catch {
    done({ ok: false, failure: { code: "ENGINE_FAILED", stage: "engine" } });
  }
};
`;

/** @returns {string} The app the tests run: the static export. */
export function appSourceDir() {
  return OUT;
}

/** @returns {string} The static export; nothing is copied any more (CP8b). */
export function copyAppToTempDir() {
  return OUT;
}

/**
 * Nothing to remove: the export is the repo's build output, never a throwaway copy.
 *
 * @param {string} dir The directory copyAppToTempDir gave.
 */
export function removeTempDir(dir) {
  if (dir !== OUT) rmSync(dir, { recursive: true, force: true });
}

/** @returns {Promise<number>} A free loopback port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Remember which fake API the app's stand-in engine reads from. Nothing is built here: run
 * `npm run build` in web/ first.
 *
 * @param {string} appDir The static export.
 * @param {string} apiBaseUrl The fake API's origin.
 */
export async function buildForProduction(appDir, apiBaseUrl) {
  apiOrigins.set(appDir, apiBaseUrl);
}

/**
 * Serve the static export with its CSP, the stand-in engine worker, and the fake API under this
 * same origin.
 *
 * @param {string} appDir The static export.
 * @returns {Promise<{origin: string, stop: Function}>} The app's origin and a stop function.
 */
export async function startProductionServer(appDir) {
  const api = apiOrigins.get(appDir);
  const server = await start_static_server({
    answer: async (url, request) => {
      if (url.pathname === WORKER_PATH) {
        return { status: 200, type: "text/javascript; charset=utf-8", body: STAND_IN_WORKER };
      }
      if (!url.pathname.startsWith(TEST_API_PREFIX)) return null;
      const response = await fetch(`${api}${url.pathname.slice(TEST_API_PREFIX.length)}${url.search}`, {
        method: request.method,
      });
      return { status: response.status, type: "application/json", body: await response.text() };
    },
  });
  return { origin: server.origin, stop: server.close };
}

/**
 * The import a route names with `?import=`, or else the newest the fake API lists.
 *
 * @param {object} web From startProductionServer.
 * @param {string} route The route, with its query.
 * @returns {Promise<number|null>} The import's id, or null when the API lists none.
 */
async function importFor(web, route) {
  const named = new URL(route, web.origin).searchParams.get("import");
  if (named && /^\d+$/.test(named)) return Number(named);
  const listed = await (await fetch(`${web.origin}${TEST_API_PREFIX}/api/v1/imports?limit=1`)).json();
  return listed.items?.[0]?.id ?? null;
}

/**
 * Open `route` with its import read into the app, as a user would: choose the statement on
 * /upload, proceed, then move to the route with the app's own router. When the fake API lists no
 * imports, or the route is not a statement screen, the route opens on its own.
 *
 * @param {object} page A CDP page (support/cdp-browser.mjs).
 * @param {object} web From startProductionServer.
 * @param {string} route The route, with its query.
 * @returns {Promise<"route"|"recovery">} Where the app ended up.
 */
export async function openWithImport(page, web, route) {
  const importId = STATEMENT_SCREENS.test(new URL(route, web.origin).pathname) ? await importFor(web, route) : null;
  if (importId === null) {
    await page.goto(`${web.origin}${route}`);
    return "route";
  }
  const file = join(statementFiles, `import-${importId}.pdf`);
  writeFileSync(file, `${IMPORT_MARKER}${importId}`);
  await page.goto(`${web.origin}/upload/`);
  await page.waitFor(`!!document.querySelector('input[type="file"]')`, "the file chooser", SLOW_STEP_MS);
  const { result } = await page.send("Runtime.evaluate", {
    expression: `document.querySelector('input[type="file"]')`,
  });
  await page.send("DOM.setFileInputFiles", { files: [file], objectId: result.objectId });
  await page.waitFor(
    `[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Proceed") && !b.disabled)`,
    "the proceed button",
    SLOW_STEP_MS,
  );
  await page.evaluate(
    `[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Proceed")).click(); true`,
  );
  await page.waitFor(
    `/analysis-summary|recovery/.test(location.pathname)`,
    "the import to finish",
    SLOW_STEP_MS,
  );
  if (await page.evaluate(`location.pathname.includes("recovery")`)) return "recovery";
  await appGoto(page, route);
  return "route";
}

/**
 * Move to `route` with the app's own router, keeping the session (a full load would forget it).
 *
 * @param {object} page A CDP page showing the app.
 * @param {string} route The route, with its query.
 */
export async function appGoto(page, route) {
  const target = new URL(route, "http://app.local");
  const wanted = `${target.pathname.replace(/\/$/, "") || "/"}${target.search}`;
  await page.evaluate(`window.next.router.push(${JSON.stringify(route)}); true`);
  // The whole address, query included: a move between two Ledger scopes keeps the same path.
  await page.waitFor(
    `(location.pathname.replace(/\\/$/, "") || "/") + location.search === ${JSON.stringify(wanted)}`,
    `the move to ${route}`,
    SLOW_STEP_MS,
  );
}
