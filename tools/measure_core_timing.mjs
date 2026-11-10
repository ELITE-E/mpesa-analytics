#!/usr/bin/env node
// Times the pandas-free core under the pinned Pyodide: build_rows, canonicalize, classify. Prints
// numbers only. Run tools/vendor.py and `uv build --wheel` first.
//   node tools/measure_core_timing.mjs --pages <statement pages JSON> [--wheel dist/x.whl]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexURL = join(repo, "web/public/vendor/pyodide") + sep;
const FAILURE = 1;
const REPEATS = 3;
const MS_PER_SECOND = 1000;
const DIGITS = 3;
const IMPORT_CORE = `
from mpesa_core.classification.classify import classify_transactions
from mpesa_core.cleaning.canonicalize import canonicalize_rows
from mpesa_core.extraction.rows import build_rows
`;
const RUN_PIPELINE = `
import json
statement_pages = json.loads(pages_json)
classified_rows, diagnostics = classify_transactions(canonicalize_rows(build_rows(statement_pages)))
row_count = len(classified_rows)
`;

process.exit(await main());

/**
 * Load Pyodide and the core, then time the pipeline on one statement.
 *
 * Side effects: reads the wheel and the pages file, and writes numbers to stdout.
 *
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  const pagesPath = argumentValue("--pages");
  const wheelPath = argumentValue("--wheel") ?? newestWheel();
  if (!pagesPath || !existsSync(pagesPath) || !wheelPath || !existsSync(wheelPath)) {
    console.log("measure_core_timing: ERROR (pages or wheel not found)");
    return FAILURE;
  }
  const coldStarted = performance.now();
  const { loadPyodide } = await import(pathToFileURL(join(indexURL, "pyodide.mjs")));
  const pyodide = await loadPyodide({ indexURL });
  const extractDir = pyodide.runPython("import site; site.getsitepackages()[0]");
  pyodide.unpackArchive(new Uint8Array(readFileSync(wheelPath)), "wheel", { extractDir });
  pyodide.runPython(IMPORT_CORE);
  const coldSeconds = seconds(performance.now() - coldStarted);
  pyodide.globals.set("pages_json", readFileSync(pagesPath, "utf8"));
  const runs = [];
  for (let run = 0; run < REPEATS; run++) runs.push(timeRun(pyodide));
  printNumbers(pyodide, coldSeconds, runs);
  return 0;
}

/**
 * Run the pipeline once and time it.
 *
 * Side effects: runs Python inside Pyodide.
 *
 * @param {object} pyodide Loaded Pyodide instance.
 * @returns {number} Seconds taken.
 */
function timeRun(pyodide) {
  const started = performance.now();
  pyodide.runPython(RUN_PIPELINE);
  return seconds(performance.now() - started);
}

/**
 * Print fixed labels and numbers.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} pyodide Pyodide instance that ran the pipeline.
 * @param {number} coldSeconds Time to load Pyodide, install the wheel and import the core.
 * @param {number[]} runs Seconds per pipeline run, first run first.
 */
function printNumbers(pyodide, coldSeconds, runs) {
  const sorted = [...runs].sort((left, right) => left - right);
  const numbers = {
    rows: pyodide.globals.get("row_count"),
    cold_load_seconds: coldSeconds,
    first_run_seconds: runs[0],
    median_run_seconds: sorted[Math.floor(sorted.length / 2)],
    wasm_memory_bytes: pyodide._module.HEAP8.length,
    node_rss_bytes: process.memoryUsage().rss,
  };
  for (const [label, value] of Object.entries(numbers)) console.log(`${label}: ${value}`);
}

/**
 * Convert milliseconds to seconds.
 *
 * Side effects: none.
 *
 * @param {number} milliseconds A duration.
 * @returns {number} Seconds, to three places.
 */
function seconds(milliseconds) {
  return Number((milliseconds / MS_PER_SECOND).toFixed(DIGITS));
}

/**
 * Read a command-line option's value.
 *
 * Side effects: none.
 *
 * @param {string} name Option name.
 * @returns {string|undefined} The value, if the option was given.
 */
function argumentValue(name) {
  const position = process.argv.indexOf(name);
  return position > 0 ? process.argv[position + 1] : undefined;
}

/**
 * Find the wheel that `uv build --wheel` left in dist/.
 *
 * Side effects: reads the directory.
 *
 * @returns {string|undefined} Path of the wheel, if there is one.
 */
function newestWheel() {
  const dist = join(repo, "dist");
  if (!existsSync(dist)) return undefined;
  const wheels = readdirSync(dist).filter((name) => name.endsWith(".whl"));
  return wheels.length ? join(dist, wheels.sort().at(-1)) : undefined;
}
