// The statement engine's module worker: pdf.js reads the PDF into statement pages, then the core
// runs under Pyodide. The password is used once, for pdf.js, and never logged, posted back or
// passed to Python. Only codes, counts, timings and JSON text leave this worker.

import { plan_import, reader_failure, run_pipeline } from "./bridge.js";
import { configure_reader, extract_statement_pages } from "./pdfjs/adapter.js";
import { load_runtime } from "./runtime.js";

let runtime = null;
let cspViolations = 0;

self.addEventListener("securitypolicyviolation", () => {
  cspViolations += 1;
});

self.onmessage = ({ data: message }) => {
  if (message.type === "start") start(message.runtime_url);
  if (message.type === "run") run(message);
  if (message.type === "warm_up") warm_up();
};

/**
 * Load and verify the runtime, then say so.
 *
 * Side effects: loads pdf.js and Pyodide, and posts `ready` or `start_failed`.
 *
 * @param {string} runtimeUrl The runtime's URL.
 * @returns {Promise<void>} Resolves once the outcome is posted.
 */
async function start(runtimeUrl) {
  try {
    runtime = await load_runtime(runtimeUrl);
    configure_reader({ pdfjsLib: runtime.pdfjsLib, workerSrc: runtime.workerSrc });
    self.postMessage({ type: "ready", timings: runtime.timings });
  } catch {
    // Any load failure, a checksum or a CSP refusal alike, is reported by code only.
    self.postMessage({
      type: "start_failed",
      failure: { code: "ENGINE_FAILED", stage: "runtime" },
    });
  }
}

/**
 * Read one statement and run the core on it.
 *
 * Side effects: runs pdf.js and Pyodide, and posts `run_done`.
 *
 * @param {object} message The run request: request_id, pdf_bytes, password, limits,
 *   processed_at and include_statement_pages.
 * @returns {Promise<void>} Resolves once the outcome is posted.
 */
async function run(message) {
  const readStarted = performance.now();
  const statementPagesText = await read_statement(message);
  const readMs = performance.now() - readStarted;
  if (typeof statementPagesText !== "string") {
    post_done(message, { ok: false, failure: statementPagesText }, { read_ms: readMs });
    return;
  }
  const coreStarted = performance.now();
  post_progress(message, { stage: "core" });
  // Tell the page when the analysis step has to load pandas, so it can show that stage.
  const core = {
    ...runtime.core,
    load_analysis_runtime: () => {
      post_progress(message, { stage: "analysis" });
      return runtime.core.load_analysis_runtime();
    },
  };
  const outcome = await run_pipeline(core, statementPagesText, message.processed_at);
  const coreMs = performance.now() - coreStarted;
  const { pandas_load_ms: pandasLoadMs, ...coreOutcome } = outcome;
  if (message.include_statement_pages) coreOutcome.statement_pages_json = statementPagesText;
  if (coreOutcome.ok && typeof message.existing_transactions_json === "string") {
    const planned = plan_import(
      runtime.core,
      coreOutcome.pipeline_result_json,
      message.existing_transactions_json,
    );
    if (planned.ok) coreOutcome.plan_json = planned.plan_json;
    else Object.assign(coreOutcome, { ok: false, failure: planned.failure });
  }
  post_done(message, coreOutcome, {
    read_ms: readMs,
    core_ms: coreMs,
    pandas_load_ms: pandasLoadMs ?? null,
  });
}

/**
 * Read the PDF into statement pages, as JSON text.
 *
 * Side effects: runs pdf.js; forgets the password as soon as pdf.js has it.
 *
 * @param {object} message The run request.
 * @returns {Promise<string|object>} The statement pages as JSON text, or the reader's failure.
 */
async function read_statement(message) {
  let password = message.password;
  message.password = undefined;
  try {
    const pdfBytes = new Uint8Array(message.pdf_bytes);
    /**
     * Report one page read.
     *
     * @param {number} page The page just read.
     * @param {number} pageCount The statement's page count.
     * @returns {void}
     */
    const onPage = (page, pageCount) =>
      post_progress(message, { stage: "reading", page, page_count: pageCount });
    return JSON.stringify(
      await extract_statement_pages(pdfBytes, password, message.limits, onPage),
    );
  } catch (error) {
    return reader_failure(error);
  } finally {
    password = undefined;
  }
}

/**
 * Post a run's outcome with its timings and the worker's own counts.
 *
 * Side effects: posts `run_done`.
 *
 * @param {object} message The run request.
 * @param {object} outcome `{ok, pipeline_result_json?, statement_pages_json?, failure?}`.
 * @param {object} timings The run's timings in milliseconds.
 */
function post_done(message, outcome, timings) {
  self.postMessage({
    type: "run_done",
    request_id: message.request_id,
    ...outcome,
    timings: {
      ...timings,
      csp_violations: cspViolations,
      wasm_memory_bytes: runtime.core.wasm_memory_bytes(),
    },
  });
}

/**
 * Load and import pandas before the first statement needs it (the app's warm-up, CP8b). Only
 * counts and timings leave the worker.
 *
 * Side effects: loads the analysis runtime into Pyodide; posts `warmed`.
 *
 * @returns {Promise<void>} Resolves once the outcome is posted.
 */
async function warm_up() {
  const started = performance.now();
  try {
    await runtime.core.warm_analysis();
  } catch {
    // A failed warm-up costs nothing: the first run loads pandas itself and reports any failure.
  }
  self.postMessage({ type: "warmed", timings: { warm_up_ms: performance.now() - started } });
}

/**
 * Tell the page how far a run has got: a stage name and, while reading, the page counts.
 *
 * Side effects: posts `progress`.
 *
 * @param {object} message The run request.
 * @param {object} step `{stage, page?, page_count?}`; never anything from the statement.
 */
function post_progress(message, step) {
  self.postMessage({ type: "progress", request_id: message.request_id, ...step });
}
