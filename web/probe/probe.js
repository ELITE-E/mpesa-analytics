// Everything lives in this file because the CSP under test forbids inline script.
const INDEX_URL = "/public/vendor/pyodide/";
const COLD_BYTES = 1_000_000;
const SAMPLE_INTERVAL_MS = 100;
const VIOLATION_GRACE_MS = 5_000;
const ERROR_MESSAGE_LIMIT = 200;
const EXPECTED_GROUPBY = "{'a': 4, 'b': 6}";
const EXPECTED_FFI = 5;
const start = performance.now();
const violations = [];
// A blocked wasm compile leaves loadPyodide pending forever, so a violation must end the run.
const blocked = new Promise((_, reject) => {
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    setTimeout(() => reject(new Error("blocked by CSP")), VIOLATION_GRACE_MS);
  });
});

let peakHeap = 0;
const sampler = setInterval(samplePeak, SAMPLE_INTERVAL_MS);

const GROUPBY = `
import pandas as pd
df = pd.DataFrame({"k": ["a", "b", "a", "b"], "v": [1, 2, 3, 4]})
str(df.groupby("k")["v"].sum().to_dict())
`;
// Crosses the FFI both ways, the path most likely to hit eval under a strict CSP.
const FFI = `
from js import Math
from pyodide.ffi import create_proxy, to_js
proxy = create_proxy(lambda value: value + 1)
try:
    outcome = proxy(1) + int(Math.abs(-1)) + to_js([1, 2]).length
finally:
    proxy.destroy()
outcome
`;

await finishProbe();

/**
 * Run the probe, then publish and display its outcome.
 *
 * Side effects: updates the page, localStorage and `window.__probeResult`.
 *
 * @returns {Promise<void>} Resolves when the outcome has been published.
 */
async function finishProbe() {
  let outcome;
  try {
    outcome = await Promise.race([run(), blocked]);
  } catch (error) {
    outcome = {
      status: "error",
      error: String(error?.message ?? error).slice(0, ERROR_MESSAGE_LIMIT),
    };
  }
  clearInterval(sampler);
  const network = networkTotals();
  Object.assign(outcome, network, {
    kind: network.transferBytes > COLD_BYTES ? "cold" : "warm",
    peakJsHeapBytes: performance.memory ? peakHeap : null,
    violations: violations.length,
    violationDetail: violations.slice(0, 5),
    cores: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
  });
  render(outcome, remember(outcome));
  window.__probeResult = outcome;
}

/**
 * Load Pyodide and pandas, then time a groupby and a trip across the FFI.
 *
 * Side effects: downloads the runtime and samples memory.
 *
 * @returns {Promise<object>} Timings in milliseconds and the WASM heap size.
 * @throws {Error} If the groupby or the FFI check gives the wrong answer.
 */
async function run() {
  const { loadPyodide } = await import(`${INDEX_URL}pyodide.mjs`);
  const t0 = performance.now();
  const pyodide = await loadPyodide({ indexURL: INDEX_URL });
  const t1 = performance.now();
  await pyodide.loadPackage("pandas", { messageCallback: () => {} });
  const t2 = performance.now();
  const groupby = pyodide.runPython(GROUPBY);
  const t3 = performance.now();
  const ffi = pyodide.runPython(FFI);
  if (groupby !== EXPECTED_GROUPBY || ffi !== EXPECTED_FFI) {
    throw new Error("unexpected probe outcome");
  }
  samplePeak();
  return {
    status: "ok",
    importMs: t0 - start,
    loadPyodideMs: t1 - t0,
    loadPandasMs: t2 - t1,
    groupbyMs: t3 - t2,
    totalMs: t3 - start,
    wasmHeapBytes: pyodide._module.HEAP8.length,
  };
}

/**
 * Record the current JS heap if it is the largest seen.
 *
 * Side effects: updates `peakHeap`.
 */
function samplePeak() {
  if (performance.memory) peakHeap = Math.max(peakHeap, performance.memory.usedJSHeapSize);
}

/**
 * Total what the page fetched, from the Resource Timing buffer.
 *
 * Side effects: none.
 *
 * @returns {{requests: number, transferBytes: number, decodedBytes: number}} Network totals.
 */
function networkTotals() {
  const entries = performance.getEntriesByType("resource");
  const transfer = entries.reduce((sum, entry) => sum + entry.transferSize, 0);
  const decoded = entries.reduce((sum, entry) => sum + entry.decodedBodySize, 0);
  return { requests: entries.length, transferBytes: transfer, decodedBytes: decoded };
}

/**
 * Keep the last successful cold and warm outcome for side-by-side display.
 *
 * Side effects: reads and writes localStorage.
 *
 * @param {object} outcome This load's outcome.
 * @returns {object} Saved outcomes keyed by kind; empty if storage is unavailable.
 */
function remember(outcome) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("probe") ?? "{}");
    if (outcome.status === "ok") saved[outcome.kind] = outcome;
    localStorage.setItem("probe", JSON.stringify(saved));
  } catch {
    // Storage is a convenience here; the current run still renders.
  }
  return saved;
}

/**
 * Show this load and the saved loads in the results table.
 *
 * Side effects: updates the page.
 *
 * @param {object} outcome This load's outcome.
 * @param {object} saved Saved outcomes keyed by kind.
 */
function render(outcome, saved) {
  document.getElementById("status").textContent =
    outcome.status === "ok" ? `Done: ${outcome.kind} load.` : `Failed: ${outcome.error}`;
  const metrics = [
    ["totalMs", "Total, ms"],
    ["loadPyodideMs", "loadPyodide, ms"],
    ["loadPandasMs", "load pandas, ms"],
    ["groupbyMs", "groupby, ms"],
    ["transferBytes", "Bytes over network"],
    ["decodedBytes", "Bytes decoded"],
    ["peakJsHeapBytes", "Peak JS heap, bytes (performance.memory)"],
    ["wasmHeapBytes", "WASM heap, bytes"],
    ["violations", "CSP violations"],
  ];
  const body = document.getElementById("rows");
  for (const [key, label] of metrics) {
    const row = body.insertRow();
    for (const text of [label, outcome[key], saved.cold?.[key], saved.warm?.[key]]) {
      row.insertCell().textContent = formatCell(text);
    }
  }
}

/**
 * Format one table cell.
 *
 * Side effects: none.
 *
 * @param {number|string|null|undefined} value Cell value.
 * @returns {string} Rounded number, the text itself, or a dash when missing.
 */
function formatCell(value) {
  return typeof value === "number" ? String(Math.round(value)) : (value ?? "–");
}
