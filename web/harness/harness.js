// The CP8a harness page: starts the engine and exposes it to the real-Chrome tests as
// window.harness. On screen it shows codes and counts only, never statement text.
import { create_statement_engine } from "/pdf_reader/engine_client.js";

const WORKER_URL = "/pdf_reader/reader.worker.js";
const RUNTIME_POINTER = "/runtime/current.json";

let violations = 0;
document.addEventListener("securitypolicyviolation", () => {
  violations += 1;
});

const engine_promise = open_engine();

window.harness = {
  ready: async () => (await engine_promise).ready(),
  run_statement: (pdfBase64, options) => run_statement(Uint8Array.fromBase64(pdfBase64), options),
  csp_violations: () => violations,
};

document.getElementById("statement-form").addEventListener("submit", show_statement_outcome);
window.harness.ready().then((started) => show({ ready: started.ok, failure: started.failure }));

/**
 * Create the engine around the verified runtime the pointer names.
 *
 * Side effects: fetches the runtime pointer.
 *
 * @returns {Promise<object>} The statement engine.
 */
async function open_engine() {
  const pointer = await (await fetch(RUNTIME_POINTER)).json();
  return create_statement_engine({
    create_worker: () => new Worker(WORKER_URL, { type: "module" }),
    runtime_url: `/runtime/${pointer.version}/`,
  });
}

/**
 * Run one statement through the engine.
 *
 * Side effects: hands the PDF and password to the worker.
 *
 * @param {Uint8Array} pdfBytes The PDF's bytes, transferred to the worker.
 * @param {object} [options] Run options: password, limits, timeout_ms, processed_at,
 *   include_statement_pages.
 * @returns {Promise<object>} The engine's outcome.
 */
async function run_statement(pdfBytes, options = {}) {
  const engine = await engine_promise;
  return engine.run({ ...options, pdf_bytes: pdfBytes });
}

/**
 * Run the chosen file and show counts and codes.
 *
 * Side effects: reads the file, clears the password field and writes to the page.
 *
 * @param {Event} event The form's submit event.
 * @returns {Promise<void>} Resolves once the outcome is shown.
 */
async function show_statement_outcome(event) {
  event.preventDefault();
  const file = document.getElementById("statement-file").files[0];
  const passwordField = document.getElementById("statement-password");
  if (!file) return;
  const password = passwordField.value || undefined;
  passwordField.value = "";
  const outcome = await run_statement(new Uint8Array(await file.arrayBuffer()), { password });
  if (!outcome.ok) {
    show({ failure: outcome.failure, timings: outcome.timings });
    return;
  }
  const pipelineResult = JSON.parse(outcome.pipeline_result_json);
  show({
    transactions: pipelineResult.transactions.length,
    diagnostics: pipelineResult.diagnostics.length,
    chain_breaks: pipelineResult.quality.chain_breaks,
    timings: outcome.timings,
  });
}

/**
 * Show a summary of counts and codes.
 *
 * Side effects: writes to the page.
 *
 * @param {object} summary Counts, codes and timings only.
 */
function show(summary) {
  document.getElementById("outcome").textContent = JSON.stringify(summary, null, 2);
}
