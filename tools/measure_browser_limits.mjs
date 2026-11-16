#!/usr/bin/env node
// Measures the browser engine on the synthetic F-LARGE statement (5,700 rows) in headless Chrome,
// to set the desktop limits in pdf_reader/limits.js. Prints counts and milliseconds only.
// Linux only: peak memory is the summed RSS of Chrome's process tree, sampled from /proc.
//   node tools/measure_browser_limits.mjs [--rows N]
// --rows draws F-LARGE's layout with another row count, to check a proposed page limit.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { open_session, other_requests, run_in_browser } from "./browser/browser_session.js";
import { generate_large, start_rss_sampler } from "./browser/measurement.js";

const NO_LIMITS = {
  byteLimit: Number.MAX_SAFE_INTEGER,
  pageLimit: Number.MAX_SAFE_INTEGER,
};
const MEASURE_TIMEOUT_MS = 30 * 60 * 1000;

process.exit(await main());

/**
 * Generate F-LARGE, run it cold then warm, and print what was measured.
 *
 * Side effects: writes F-LARGE to a temporary directory and deletes it; starts a server and
 * Chrome; prints counts.
 *
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  const directory = mkdtempSync(join(tmpdir(), "f-large-"));
  try {
    const { values } = parseArgs({ options: { rows: { type: "string" } } });
    const pdfBytes = generate_large(directory, values.rows);
    const session = await open_session();
    const sampler = start_rss_sampler();
    try {
      const cold = await measured_run(session, pdfBytes);
      const warm = await measured_run(session, pdfBytes);
      print_measurements(session, pdfBytes, cold, warm, sampler.peak());
      return cold.ok && warm.ok && other_requests(session).length === 0 ? 0 : 1;
    } finally {
      sampler.stop();
      await session.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Run the PDF once, with no limits, and time the whole run as the page sees it.
 *
 * Side effects: runs the engine.
 *
 * @param {object} session The browser session.
 * @param {Uint8Array} pdfBytes The PDF.
 * @returns {Promise<object>} The outcome with `total_ms` added.
 */
async function measured_run(session, pdfBytes) {
  const started = performance.now();
  const outcome = await run_in_browser(session, pdfBytes, {
    limits: NO_LIMITS,
    timeout_ms: MEASURE_TIMEOUT_MS,
    include_statement_pages: true,
  });
  return { ...outcome, total_ms: performance.now() - started };
}

/**
 * Print the counts: size, pages, rows, timings and memory.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} session The browser session.
 * @param {Uint8Array} pdfBytes The PDF.
 * @param {object} cold The first run's outcome.
 * @param {object} warm The second run's outcome.
 * @param {number} peakRssBytes The highest summed RSS seen.
 */
function print_measurements(session, pdfBytes, cold, warm, peakRssBytes) {
  const pages = cold.ok ? JSON.parse(cold.statement_pages_json).pages.length : null;
  const rows = cold.ok ? JSON.parse(cold.pipeline_result_json).transactions.length : null;
  const lines = [
    "fixture: F-LARGE",
    `pdf_bytes: ${pdfBytes.length}`,
    `pages: ${pages}`,
    `rows: ${rows}`,
    `runtime_load_ms: ${Math.round(session.ready.timings.runtime_load_ms)}`,
    ...run_lines("cold", cold),
    ...run_lines("warm", warm),
    `peak_rss_bytes: ${peakRssBytes}`,
    `wasm_memory_bytes: ${warm.timings?.wasm_memory_bytes ?? cold.timings?.wasm_memory_bytes}`,
    `other_requests: ${other_requests(session).length}`,
  ];
  console.log(lines.join("\n"));
}

/**
 * Describe one run in milliseconds.
 *
 * Side effects: none.
 *
 * @param {string} label "cold" or "warm".
 * @param {object} outcome The run's outcome.
 * @returns {string[]} Lines of the form `label_field: value`.
 */
function run_lines(label, outcome) {
  const timings = outcome.timings ?? {};
  return [
    `${label}_ok: ${outcome.ok}${outcome.ok ? "" : ` (${outcome.failure.code})`}`,
    `${label}_read_ms: ${rounded(timings.read_ms)}`,
    `${label}_core_ms: ${rounded(timings.core_ms)}`,
    `${label}_pandas_load_ms: ${rounded(timings.pandas_load_ms)}`,
    `${label}_total_ms: ${rounded(outcome.total_ms)}`,
  ];
}

/**
 * Write a timing as whole milliseconds.
 *
 * Side effects: none.
 *
 * @param {number|null|undefined} value Milliseconds, if measured.
 * @returns {number|string} The rounded number, or "-".
 */
function rounded(value) {
  return value == null ? "-" : Math.round(value);
}
