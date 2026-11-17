// The Pyodide bridge, inside the worker: statement pages go to mpesa_core as JSON text and the
// pipeline result comes back as JSON text, so no JavaScript or Python proxy crosses either way.
// Every failure leaves as a code and at most a row position (ADR 0004).

import { ExtractionError } from "./pdfjs/adapter.js";

/** Codes the engine reports: the PDF reader's, layout, and one for the engine itself. */
export const ENGINE_FAILURE_CODES = new Set([
  "NOT_A_PDF",
  "PASSWORD_REQUIRED",
  "PASSWORD_INCORRECT",
  "CORRUPT_PDF",
  "TOO_LARGE",
  "TOO_MANY_PAGES",
  "TIMEOUT",
  "LAYOUT_UNRECOGNIZED",
  "ENGINE_FAILED",
]);

const ANALYSIS_RUNTIME_MISSING = "ANALYSIS_RUNTIME_MISSING";
// Core codes meaning the PDF opened but its text is not an M-PESA statement the core can read.
const CORE_LAYOUT_CODES = new Set([
  "LAYOUT_UNRECOGNIZED",
  "NO_PAGES",
  "BRAND_MISSING",
  "ANCHOR_MISSING",
  "TOKEN_MISSING",
  "DOMAIN_ROW",
  "DATE_UNREADABLE",
  "ANALYSIS_FAILED",
  // Too few money-in or money-out entries to place the amount columns (CP8b).
  "TOO_FEW_AMOUNTS",
]);

/**
 * Run the core on one statement's pages, loading pandas only if the analysis step needs it.
 *
 * Side effects: calls the core, and may load the analysis runtime once.
 *
 * @param {object} core The loaded core.
 * @param {Function} core.run_json mpesa_core.bridge.run_json: JSON text and a time in, JSON text out.
 * @param {Function} core.load_analysis_runtime Loads pandas; resolves to the milliseconds it took.
 * @param {string} statementPagesText The statement pages as JSON text.
 * @param {string|null} processedAt A time chosen by the caller, carried into the result.
 * @returns {Promise<object>} `{ok: true, pipeline_result_json, pandas_load_ms}` or
 *   `{ok: false, failure, pandas_load_ms}`. The load time is null unless this run loaded pandas.
 *   A pandas load that fails is ENGINE_FAILED at the runtime stage.
 */
export async function run_pipeline(core, statementPagesText, processedAt) {
  let envelope = call_core(core, statementPagesText, processedAt);
  let pandasLoadMs = null;
  if (envelope?.error?.code === ANALYSIS_RUNTIME_MISSING) {
    pandasLoadMs = await load_quietly(core);
    if (pandasLoadMs === null) return failed({ code: "ENGINE_FAILED", stage: "runtime" }, null);
    envelope = call_core(core, statementPagesText, processedAt);
  }
  if (envelope === null || envelope.error?.code === ANALYSIS_RUNTIME_MISSING) {
    return failed({ code: "ENGINE_FAILED", stage: "core" }, pandasLoadMs);
  }
  if (!envelope.ok) return failed(core_failure(envelope.error), pandasLoadMs);
  return {
    ok: true,
    pipeline_result_json: JSON.stringify(envelope.pipeline_result),
    pandas_load_ms: pandasLoadMs,
  };
}

/**
 * Load pandas, turning a failure into null.
 *
 * Side effects: loads the analysis runtime.
 *
 * @param {object} core The loaded core.
 * @returns {Promise<number|null>} The milliseconds the load took, or null if it failed; the
 *   failure's message may name files and is dropped.
 */
async function load_quietly(core) {
  try {
    return await core.load_analysis_runtime();
  } catch {
    return null;
  }
}

/**
 * A failed run's outcome.
 *
 * Side effects: none.
 *
 * @param {object} failure The engine failure.
 * @param {number|null} pandasLoadMs How long this run spent loading pandas, if it did.
 * @returns {object} `{ok: false, failure, pandas_load_ms}`.
 */
function failed(failure, pandasLoadMs) {
  return { ok: false, failure, pandas_load_ms: pandasLoadMs };
}

/**
 * Ask the core how the browser store would take this statement's rows: insert, link or preserve
 * each, against the transactions the session already holds (CP8b).
 *
 * Side effects: calls the core.
 *
 * @param {object} core The loaded core.
 * @param {Function} core.plan_json mpesa_core.bridge.plan_statement_import_json: JSON text in and out.
 * @param {string} pipelineResultJson The run's pipeline result, as JSON text.
 * @param {string} existingTransactionsJson The session's transactions, as JSON text of a list.
 * @returns {object} `{ok: true, plan_json}`, or `{ok: false, failure}` with ENGINE_FAILED if the
 *   core refuses the request; its message, which may quote a row, is dropped.
 */
export function plan_import(core, pipelineResultJson, existingTransactionsJson) {
  try {
    const request = {
      incoming_rows: JSON.parse(pipelineResultJson).transactions,
      existing_transactions: JSON.parse(existingTransactionsJson),
    };
    return { ok: true, plan_json: core.plan_json(JSON.stringify(request)) };
  } catch {
    return { ok: false, failure: { code: "ENGINE_FAILED", stage: "core" } };
  }
}

/**
 * Turn a PDF reader failure into the engine's failure.
 *
 * Side effects: none.
 *
 * @param {unknown} error What the reader threw.
 * @returns {{code: string, stage: string}} The reader's code, or ENGINE_FAILED for anything
 *   else; never the error's message.
 */
export function reader_failure(error) {
  const code = error instanceof ExtractionError ? error.code : "ENGINE_FAILED";
  return { code, stage: "reader" };
}

/**
 * Turn a core error envelope into the engine's failure.
 *
 * Side effects: none.
 *
 * @param {{code: string, row_index: number|null}} coreError The envelope's error.
 * @returns {object} LAYOUT_UNRECOGNIZED with the core's own code and row position when the
 *   statement's text could not be read as a statement; ENGINE_FAILED otherwise.
 */
export function core_failure(coreError) {
  if (!CORE_LAYOUT_CODES.has(coreError.code)) return { code: "ENGINE_FAILED", stage: "core" };
  return {
    code: "LAYOUT_UNRECOGNIZED",
    stage: "core",
    core_code: coreError.code,
    row_index: coreError.row_index,
  };
}

/**
 * Call the core once and read its envelope.
 *
 * Side effects: runs the core.
 *
 * @param {object} core The loaded core.
 * @param {string} statementPagesText The statement pages as JSON text.
 * @param {string|null} processedAt The caller's time.
 * @returns {object|null} The envelope, or null if the core threw: an unexpected Python error,
 *   whose message may hold a traceback and is dropped.
 */
function call_core(core, statementPagesText, processedAt) {
  try {
    return JSON.parse(core.run_json(statementPagesText, processedAt));
  } catch {
    return null;
  }
}
