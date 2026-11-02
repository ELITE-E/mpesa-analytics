// Everything lives in this file because the CSP under test forbids inline script.
const INDEX_URL = "/public/vendor/pyodide/";
const COLD_BYTES = 1_000_000;
const start = performance.now();
const VIOLATION_GRACE_MS = 5_000;
const violations = [];
// A blocked wasm compile leaves loadPyodide pending forever, so a violation must end the run.
const blocked = new Promise((_, reject) => {
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    setTimeout(() => reject(new Error("blocked by CSP")), VIOLATION_GRACE_MS);
  });
});

let peakHeap = 0;
const samplePeak = () => {
  if (performance.memory) peakHeap = Math.max(peakHeap, performance.memory.usedJSHeapSize);
};
const sampler = setInterval(samplePeak, 100);

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
    result = proxy(1) + int(Math.abs(-1)) + to_js([1, 2]).length
finally:
    proxy.destroy()
result
`;

function networkTotals() {
  const entries = performance.getEntriesByType("resource");
  const transfer = entries.reduce((sum, e) => sum + e.transferSize, 0);
  const decoded = entries.reduce((sum, e) => sum + e.decodedBodySize, 0);
  return { requests: entries.length, transferBytes: transfer, decodedBytes: decoded };
}

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
  if (groupby !== "{'a': 4, 'b': 6}" || ffi !== 5) throw new Error("unexpected probe result");
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

function remember(result) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("probe") ?? "{}");
    if (result.status === "ok") saved[result.kind] = result;
    localStorage.setItem("probe", JSON.stringify(saved));
  } catch {
    // Storage is a convenience here; the current run still renders.
  }
  return saved;
}

function render(result, saved) {
  document.getElementById("status").textContent =
    result.status === "ok" ? `Done: ${result.kind} load.` : `Failed: ${result.error}`;
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
  const format = (value) => (typeof value === "number" ? String(Math.round(value)) : (value ?? "–"));
  const body = document.getElementById("rows");
  for (const [key, label] of metrics) {
    const row = body.insertRow();
    for (const text of [label, result[key], saved.cold?.[key], saved.warm?.[key]]) {
      row.insertCell().textContent = format(text);
    }
  }
}

let result;
try {
  result = await Promise.race([run(), blocked]);
} catch (error) {
  result = { status: "error", error: String(error?.message ?? error).slice(0, 200) };
}
clearInterval(sampler);
const network = networkTotals();
Object.assign(result, network, {
  kind: network.transferBytes > COLD_BYTES ? "cold" : "warm",
  peakJsHeapBytes: performance.memory ? peakHeap : null,
  violations: violations.length,
  violationDetail: violations.slice(0, 5),
  cores: navigator.hardwareConcurrency,
  userAgent: navigator.userAgent,
});
render(result, remember(result));
window.__probeResult = result;
