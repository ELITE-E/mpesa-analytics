// Measurement only (CP8a-2): runs the statement engine's stages one at a time, so each can be timed
// and its memory read on its own. The app's worker is reader.worker.js; this one is never shipped.
// Synthetic statements only. Answers carry milliseconds and byte counts, never statement text.

import { configure_reader, extract_statement_pages } from "/pdf_reader/pdfjs/adapter.js";
import { load_runtime } from "/pdf_reader/runtime.js";

const NO_LIMITS = {
  byteLimit: Number.MAX_SAFE_INTEGER,
  pageLimit: Number.MAX_SAFE_INTEGER,
  timeoutMs: 2 ** 31 - 1,
};
// Each core stage, in pipeline.run's order, as the Python that runs it on the stage before.
const PYTHON_STAGES = {
  bridge_in: "pages = json.loads(pages_text)",
  attest: "token = attest(pages)",
  build_rows: "rows = build_rows(pages)",
  canonicalize: "canonical = canonicalize_rows(rows)",
  classify: [
    "classified, diagnostics = classify_transactions(canonical)",
    "transactions = [_with_plain_classes(row) for row in classified]",
  ].join("\n"),
  pandas_import: "import pandas\nimport mpesa_core.analysis.report",
  analyze: "report = analyze_transactions(transactions)",
  reconcile: "quality = {**reconcile(pages, rows), **measure_unclassified(transactions)}",
  bridge_out: [
    "result_text = json.dumps({'token': token, 'transactions': transactions,",
    "    'report': report, 'quality': quality, 'diagnostics': diagnostics})",
  ].join("\n"),
};
const PYTHON_SETUP = [
  "import json",
  "from mpesa_core.reconciliation.attest import attest",
  "from mpesa_core.extraction.rows import build_rows",
  "from mpesa_core.cleaning.canonicalize import canonicalize_rows",
  "from mpesa_core.classification.classify import classify_transactions",
  "from mpesa_core.pipeline import _with_plain_classes",
  "from mpesa_core.analysis import analyze_transactions",
  "from mpesa_core.reconciliation.reconcile import reconcile, measure_unclassified",
].join("\n");

const state = { runtime: null, pdfBytes: null, statementPages: null, pagesText: null };

self.onmessage = async ({ data: message }) => {
  try {
    const answer = await run_step(message);
    self.postMessage({ id: message.id, ok: true, ...answer, wasm_heap_bytes: wasm_heap_bytes() });
  } catch (error) {
    // Measurement tooling: the error's name only, never its message.
    self.postMessage({ id: message.id, ok: false, error_name: error?.name ?? "Error" });
  }
};

/**
 * Run one measurement step.
 *
 * Side effects: loads the runtime, runs pdf.js or Python, and keeps each stage's output for the
 * next.
 *
 * @param {object} message `{step, ...}`: `start` with `runtime_url`, `set_pdf` with `pdf_bytes`,
 *   or a stage name.
 * @returns {Promise<object>} `ms` and counts for the step.
 * @throws {Error} If the step is unknown or fails.
 */
async function run_step(message) {
  if (message.step === "start") return start(message.runtime_url);
  if (message.step === "set_pdf") {
    state.pdfBytes = new Uint8Array(message.pdf_bytes);
    return { ms: 0 };
  }
  if (message.step === "pdfjs_extract") return timed(() => extract());
  if (message.step === "json_serialise") return timed(() => serialise());
  if (message.step === "pandas_load")
    return { ms: await state.runtime.core.load_analysis_runtime() };
  if (message.step === "bridge_in") {
    return timed(() => {
      state.runtime.pyodide.globals.set("pages_text", state.pagesText);
      return run_python(PYTHON_STAGES.bridge_in);
    });
  }
  if (message.step === "bridge_out") {
    return timed(() => {
      run_python(PYTHON_STAGES.bridge_out);
      const pyodide = state.runtime.pyodide;
      return {
        bytes: pyodide.globals.get("result_text").length,
        rows: pyodide.runPython("len(transactions)"),
      };
    });
  }
  if (message.step in PYTHON_STAGES) return timed(() => run_python(PYTHON_STAGES[message.step]));
  throw new Error("unknown step");
}

/**
 * Load the runtime as the engine does, and prepare the Python stage functions.
 *
 * Side effects: loads pdf.js, Pyodide and the wheel.
 *
 * @param {string} runtimeUrl The runtime's URL.
 * @returns {Promise<object>} The load timings.
 */
async function start(runtimeUrl) {
  state.runtime = await load_runtime(runtimeUrl);
  configure_reader({ pdfjsLib: state.runtime.pdfjsLib, workerSrc: state.runtime.workerSrc });
  run_python(PYTHON_SETUP);
  return { ms: state.runtime.timings.runtime_load_ms, timings: state.runtime.timings };
}

/**
 * Read the PDF into statement pages.
 *
 * Side effects: runs pdf.js.
 *
 * @returns {Promise<object>} Page and item counts.
 */
async function extract() {
  state.statementPages = await extract_statement_pages(state.pdfBytes, undefined, NO_LIMITS);
  const pages = state.statementPages.pages;
  return {
    pages: pages.length,
    items: pages.reduce((total, page) => total + page.items.length, 0),
  };
}

/**
 * Serialise the statement pages as the engine does before the bridge.
 *
 * Side effects: none beyond keeping the text.
 *
 * @returns {object} The text's length.
 */
function serialise() {
  state.pagesText = JSON.stringify(state.statementPages);
  return { bytes: state.pagesText.length };
}

/**
 * Run Python in the measurement interpreter.
 *
 * Side effects: runs the code, which keeps its results as globals.
 *
 * @param {string} code Python source.
 * @returns {object} The number of rows built so far, if any.
 */
function run_python(code) {
  state.runtime.pyodide.runPython(code);
  return {};
}

/**
 * Time a step, which may be synchronous or not.
 *
 * Side effects: runs the step.
 *
 * @param {Function} step The step.
 * @returns {Promise<object>} The step's counts, plus `ms`.
 */
async function timed(step) {
  const started = performance.now();
  const counts = await step();
  return { ...counts, ms: performance.now() - started };
}

/**
 * Read the size of Pyodide's wasm memory, which only grows.
 *
 * Side effects: none.
 *
 * @returns {number|null} Bytes, or null before the runtime has loaded.
 */
function wasm_heap_bytes() {
  return state.runtime?.core.wasm_memory_bytes() ?? null;
}
