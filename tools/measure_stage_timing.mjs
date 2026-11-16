#!/usr/bin/env node
// Measures each stage of the statement engine in headless Chrome, cold (a fresh worker) and warm
// (the same worker again), as the median of several runs. Prints milliseconds and byte counts
// only. Run it on an otherwise idle machine. Linux only (memory comes from /proc).
//   node tools/measure_stage_timing.mjs [--fixture NAME] [--runs 3]
// By default it generates F-LARGE (5,700 rows); --fixture uses a committed synthetic fixture.
//
// Memory per stage: wasm_heap_growth_bytes is how much Pyodide's wasm memory grew during the
// stage (it never shrinks, so this is the stage's new high-water mark); peak_rss_delta_bytes is
// the highest summed RSS of Chrome's process tree during the stage, less the sum at its start.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { open_session, other_requests } from "./browser/browser_session.js";
import { generate_large, start_rss_sampler } from "./browser/measurement.js";

const REPO = join(import.meta.dirname, "..");
const DEFAULT_RUNS = 3;
const LOAD_STAGES = ["pyodide_init", "wheel_install"];
const STATEMENT_STAGES = [
  "pdfjs_extract",
  "json_serialise",
  "bridge_in",
  "attest",
  "build_rows",
  "canonicalize",
  "classify",
  "pandas_load",
  "pandas_import",
  "analyze",
  "reconcile",
  "bridge_out",
];
// Stages that cost nothing once the worker has run a statement.
const COLD_ONLY = new Set(["pyodide_init", "wheel_install", "pandas_load", "pandas_import"]);
const FAILED = 1;

process.exit(await main());

/**
 * Measure every stage over the requested runs and print the medians.
 *
 * Side effects: may write F-LARGE to a temporary directory and delete it; starts a server and
 * Chrome per run; prints counts.
 *
 * @returns {Promise<number>} Process exit code: 0 on success, 1 if a step failed.
 */
async function main() {
  const { values } = parseArgs({
    options: { fixture: { type: "string" }, runs: { type: "string" } },
  });
  const runs = Number(values.runs ?? DEFAULT_RUNS);
  const pdfBytes = read_pdf(values.fixture);
  const sampler = start_rss_sampler();
  const measured = [];
  let otherRequests = 0;
  let facts = null;
  try {
    for (let run = 0; run < runs; run++) {
      const session = await open_session({ wait_ready: false, harness_page: "stage_timing.html" });
      try {
        const outcome = await measure_session(session, pdfBytes, sampler);
        measured.push(outcome.stages);
        facts = outcome.facts;
        otherRequests += other_requests(session).length;
      } finally {
        await session.close();
      }
    }
  } catch {
    // A failed step is reported by its absence of numbers only.
    console.log("measure_stage_timing: ERROR (STEP_FAILED)");
    return FAILED;
  } finally {
    sampler.stop();
  }
  print_report({ fixture: values.fixture ?? "F-LARGE", pdfBytes, runs, facts, measured });
  console.log(`peak_rss_bytes: ${sampler.peak()}`);
  console.log(`other_requests: ${otherRequests}`);
  return otherRequests === 0 ? 0 : FAILED;
}

/**
 * Read a committed fixture, or generate F-LARGE.
 *
 * Side effects: reads a file, or runs the generator in a temporary directory it deletes.
 *
 * @param {string|undefined} fixture A committed fixture's name, or undefined for F-LARGE.
 * @returns {Uint8Array} The PDF's bytes.
 */
function read_pdf(fixture) {
  if (fixture) {
    return new Uint8Array(readFileSync(join(REPO, "tests/fixtures/synthetic", `${fixture}.pdf`)));
  }
  const directory = mkdtempSync(join(tmpdir(), "f-large-"));
  try {
    return generate_large(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Run one cold pass on a fresh worker, then one warm pass on the same worker.
 *
 * Side effects: drives the measurement page; reads memory.
 *
 * @param {object} session The browser session on the measurement page.
 * @param {Uint8Array} pdfBytes The PDF.
 * @param {object} sampler The RSS sampler.
 * @returns {Promise<object>} `stages`: phase and stage to measurements; `facts`: counts.
 * @throws {Error} If a step fails.
 */
async function measure_session(session, pdfBytes, sampler) {
  const stages = {};
  const startAt = sampler.mark();
  const started = await call(session, "open");
  const startRss = sampler.peak_since_mark() - startAt;
  stages["cold pyodide_init"] = {
    ms: started.timings.pyodide_init_ms,
    wasm: started.wasm_heap_bytes,
    rss: startRss,
  };
  stages["cold wheel_install"] = { ms: started.timings.wheel_install_ms, wasm: null, rss: null };
  await call(session, "step", "set_pdf", { pdf_base64: Buffer.from(pdfBytes).toString("base64") });
  let heap = started.wasm_heap_bytes;
  let facts = {};
  for (const phase of ["cold", "warm"]) {
    for (const stage of STATEMENT_STAGES) {
      if (phase === "warm" && COLD_ONLY.has(stage)) continue;
      const markedAt = sampler.mark();
      const answer = await call(session, "step", stage);
      stages[`${phase} ${stage}`] = {
        ms: answer.ms,
        wasm: answer.wasm_heap_bytes - heap,
        rss: sampler.peak_since_mark() - markedAt,
      };
      heap = answer.wasm_heap_bytes;
      facts = { ...facts, ...counts_from(stage, answer) };
    }
  }
  return { stages, facts: { ...facts, wasm_heap_bytes_end: heap } };
}

/**
 * Call the measurement page and check the answer.
 *
 * Side effects: runs a step in the page's worker.
 *
 * @param {object} session The browser session.
 * @param {string} method `open` or `step`.
 * @param {...unknown} args The step's name and fields.
 * @returns {Promise<object>} The worker's answer.
 * @throws {Error} If the step failed.
 */
async function call(session, method, ...args) {
  const answer = await session.page.evaluate(
    ([name, rest]) => window.stage_timing[name](...rest),
    [method, args],
  );
  if (!answer.ok) throw new Error("measurement step failed");
  return answer;
}

/**
 * Keep the counts a stage reports about the statement.
 *
 * Side effects: none.
 *
 * @param {string} stage The stage.
 * @param {object} answer Its answer.
 * @returns {object} Pages and items from extraction, rows and result size from the bridge.
 */
function counts_from(stage, answer) {
  if (stage === "pdfjs_extract") return { pages: answer.pages, items: answer.items };
  if (stage === "json_serialise") return { pages_json_bytes: answer.bytes };
  if (stage === "bridge_out") return { rows: answer.rows, result_json_bytes: answer.bytes };
  return {};
}

/**
 * Print the counts and every stage's medians, then which stage costs most.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} report What was measured.
 * @param {string} report.fixture The fixture's name.
 * @param {Uint8Array} report.pdfBytes The PDF.
 * @param {number} report.runs How many runs.
 * @param {object} report.facts Counts from the last run.
 * @param {object[]} report.measured Each run's stages.
 */
function print_report({ fixture, pdfBytes, runs, facts, measured }) {
  const lines = [
    `fixture: ${fixture}`,
    `pdf_bytes: ${pdfBytes.length}`,
    ...Object.entries(facts).map(([name, value]) => `${name}: ${value}`),
    `runs: ${runs}`,
  ];
  const medians = {};
  for (const phase of ["cold", "warm"]) {
    for (const stage of [...LOAD_STAGES, ...STATEMENT_STAGES]) {
      const key = `${phase} ${stage}`;
      const samples = measured.map((stages) => stages[key]).filter(Boolean);
      medians[key] = {
        ms: median(samples.map((sample) => sample.ms)),
        wasm: median(samples.map((sample) => sample.wasm)),
        rss: median(samples.map((sample) => sample.rss)),
      };
      const { ms, wasm, rss } = medians[key];
      lines.push(
        `${key}: ms=${whole(ms)} wasm_heap_growth_bytes=${whole(wasm)} peak_rss_delta_bytes=${whole(rss)}`,
      );
    }
  }
  lines.push(`slowest_cold_stage: ${largest(medians, "cold", "ms")}`);
  lines.push(`slowest_warm_stage: ${largest(medians, "warm", "ms")}`);
  lines.push(`largest_wasm_growth_cold_stage: ${largest(medians, "cold", "wasm")}`);
  lines.push(`largest_rss_delta_cold_stage: ${largest(medians, "cold", "rss")}`);
  lines.push(`largest_rss_delta_warm_stage: ${largest(medians, "warm", "rss")}`);
  console.log(lines.join("\n"));
}

/**
 * The median of the numbers given, ignoring missing ones.
 *
 * Side effects: none.
 *
 * @param {Array<number|null|undefined>} values The samples.
 * @returns {number|null} The median, or null if there is none.
 */
function median(values) {
  const sorted = values
    .filter((value) => typeof value === "number")
    .sort((first, second) => first - second);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Write a measurement as a whole number, or "-" when there is none.
 *
 * Side effects: none.
 *
 * @param {number|null} value The measurement.
 * @returns {string} The rounded number or "-".
 */
function whole(value) {
  return value === null ? "-" : String(Math.max(0, Math.round(value)));
}

/**
 * Name the stage with the largest median of one measurement in one phase.
 *
 * Side effects: none.
 *
 * @param {object} medians Phase and stage to medians.
 * @param {string} phase "cold" or "warm".
 * @param {string} field "ms", "wasm" or "rss".
 * @returns {string} The stage's name.
 */
function largest(medians, phase, field) {
  const entries = Object.entries(medians).filter(
    ([key, values]) => key.startsWith(`${phase} `) && values[field] !== null,
  );
  entries.sort((first, second) => second[1][field] - first[1][field]);
  return entries[0][0].split(" ")[1];
}
