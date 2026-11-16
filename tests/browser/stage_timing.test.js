// tools/measure_stage_timing.mjs: per-stage milliseconds and memory in real Chrome, counts only.
// Run on a small committed fixture, one run, so the test stays short; the owner's measurement
// uses F-LARGE and three runs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

const REPO = join(import.meta.dirname, "../..");
const TOOL = join(REPO, "tools/measure_stage_timing.mjs");
const STAGES = [
  "pyodide_init",
  "wheel_install",
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
const COUNT_LINE = /^[a-z_]+: [0-9A-Za-z_.()-]+$/;
const STAGE_LINE =
  /^(cold|warm) ([a-z_]+): ms=(\d+|-) wasm_heap_growth_bytes=(\d+|-) peak_rss_delta_bytes=(\d+|-)$/;

test("every stage is reported cold and warm, in milliseconds and bytes only", () => {
  const ran = spawnSync(process.execPath, [TOOL, "--fixture", "F-BASIC", "--runs", "1"], {
    encoding: "utf8",
    timeout: 900_000,
  });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const lines = ran.stdout.trim().split("\n");
  const stageLines = lines.filter((line) => STAGE_LINE.test(line));
  for (const line of lines.filter((line) => !STAGE_LINE.test(line))) {
    assert.match(line, COUNT_LINE);
  }
  for (const phase of ["cold", "warm"]) {
    const named = stageLines.filter((line) => line.startsWith(`${phase} `));
    assert.deepEqual(
      named.map((line) => line.match(STAGE_LINE)[2]),
      STAGES,
      phase,
    );
  }
  for (const stage of ["pyodide_init", "wheel_install", "pandas_load", "pandas_import"]) {
    const warmLine = stageLines.find((line) => line.startsWith(`warm ${stage}:`));
    assert.match(warmLine, /ms=- /, `warm ${stage} has no cost`);
  }
  assert.match(ran.stdout, /^runs: 1$/m);
  assert.match(ran.stdout, /^rows: \d+$/m);
  assert.match(ran.stdout, /^peak_rss_bytes: \d+$/m);
  assert.match(ran.stdout, /^other_requests: 0$/m);
  assert.match(ran.stdout, /^slowest_cold_stage: [a-z_]+$/m);
  assert.match(ran.stdout, /^largest_wasm_growth_cold_stage: [a-z_]+$/m);
  assert.match(ran.stdout, /^largest_rss_delta_cold_stage: [a-z_]+$/m);
});
