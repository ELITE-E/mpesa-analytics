import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ENGINE_FAILURE_CODES,
  core_failure,
  reader_failure,
  run_pipeline,
} from "../../pdf_reader/bridge.js";
import { ExtractionError } from "../../pdf_reader/pdfjs/adapter.js";

const READER_CODES = [
  "NOT_A_PDF",
  "PASSWORD_REQUIRED",
  "PASSWORD_INCORRECT",
  "CORRUPT_PDF",
  "TOO_LARGE",
  "TOO_MANY_PAGES",
  "TIMEOUT",
  "LAYOUT_UNRECOGNIZED",
];
const PAGES_TEXT = JSON.stringify({ schema_version: 1, engine: "test", pages: [] });

/**
 * A fake core: answers run_json from a list of envelopes and counts runtime loads.
 *
 * @param {object[]} envelopes What each run_json call returns, in order.
 * @returns {object} The fake core and its call record.
 */
function fake_core(envelopes) {
  const calls = { runs: [], analysisLoads: 0 };
  return {
    calls,
    run_json(statementPagesText, processedAt) {
      calls.runs.push([statementPagesText, processedAt]);
      return JSON.stringify(envelopes[calls.runs.length - 1]);
    },
    async load_analysis_runtime() {
      calls.analysisLoads += 1;
      return 12.5;
    },
  };
}

test("the engine reports the eight reader and layout codes and one for itself", () => {
  assert.deepEqual([...ENGINE_FAILURE_CODES].sort(), [...READER_CODES, "ENGINE_FAILED"].sort());
});

for (const code of READER_CODES) {
  test(`a reader ${code} keeps its code`, () => {
    assert.deepEqual(reader_failure(new ExtractionError(code)), { code, stage: "reader" });
  });
}

test("any other reader failure is ENGINE_FAILED and keeps no message", () => {
  const failure = reader_failure(new Error(`Example Person 12 at ${"ZZ"}REC00001`));
  assert.deepEqual(failure, { code: "ENGINE_FAILED", stage: "reader" });
});

test("core LAYOUT_UNRECOGNIZED keeps its code", () => {
  assert.deepEqual(core_failure({ code: "LAYOUT_UNRECOGNIZED", row_index: null }), {
    code: "LAYOUT_UNRECOGNIZED",
    stage: "core",
    core_code: "LAYOUT_UNRECOGNIZED",
    row_index: null,
  });
});

for (const coreCode of [
  "NO_PAGES",
  "BRAND_MISSING",
  "ANCHOR_MISSING",
  "TOKEN_MISSING",
  "DOMAIN_ROW",
  "DATE_UNREADABLE",
  "ANALYSIS_FAILED",
]) {
  test(`core ${coreCode} is LAYOUT_UNRECOGNIZED, keeping the core code and position`, () => {
    assert.deepEqual(core_failure({ code: coreCode, row_index: 3 }), {
      code: "LAYOUT_UNRECOGNIZED",
      stage: "core",
      core_code: coreCode,
      row_index: 3,
    });
  });
}

test("a malformed request or unknown core code is ENGINE_FAILED", () => {
  for (const coreCode of ["REQUEST_INVALID", "SOMETHING_NEW"]) {
    assert.equal(core_failure({ code: coreCode, row_index: null }).code, "ENGINE_FAILED");
  }
});

test("run_pipeline passes JSON text in and returns the result as JSON text", async () => {
  const pipelineResult = { schema_version: 1, transactions: [] };
  const core = fake_core([{ ok: true, pipeline_result: pipelineResult }]);
  const outcome = await run_pipeline(core, PAGES_TEXT, "2026-11-16T09:00:00Z");
  assert.deepEqual(core.calls.runs, [[PAGES_TEXT, "2026-11-16T09:00:00Z"]]);
  assert.equal(typeof outcome.pipeline_result_json, "string");
  assert.deepEqual(JSON.parse(outcome.pipeline_result_json), pipelineResult);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.pandas_load_ms, null);
  assert.equal(core.calls.analysisLoads, 0);
});

test("run_pipeline loads pandas only when the analysis asks, then runs again", async () => {
  const core = fake_core([
    { ok: false, error: { code: "ANALYSIS_RUNTIME_MISSING", row_index: null } },
    { ok: true, pipeline_result: { schema_version: 1 } },
  ]);
  const outcome = await run_pipeline(core, PAGES_TEXT, null);
  assert.equal(core.calls.analysisLoads, 1);
  assert.equal(core.calls.runs.length, 2);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.pandas_load_ms, 12.5);
});

test("run_pipeline gives up if pandas is still missing after loading it", async () => {
  const missing = { ok: false, error: { code: "ANALYSIS_RUNTIME_MISSING", row_index: null } };
  const core = fake_core([missing, missing]);
  const outcome = await run_pipeline(core, PAGES_TEXT, null);
  assert.deepEqual(outcome.failure, { code: "ENGINE_FAILED", stage: "core" });
  assert.equal(core.calls.analysisLoads, 1);
});

test("a core failure never loads pandas", async () => {
  const core = fake_core([{ ok: false, error: { code: "BRAND_MISSING", row_index: null } }]);
  const outcome = await run_pipeline(core, PAGES_TEXT, null);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure.core_code, "BRAND_MISSING");
  assert.equal(core.calls.analysisLoads, 0);
});

test("a core that throws is ENGINE_FAILED and its message is dropped", async () => {
  const core = {
    run_json() {
      throw new Error("Traceback ... Example Person 12");
    },
    async load_analysis_runtime() {
      return 0;
    },
  };
  const outcome = await run_pipeline(core, PAGES_TEXT, null);
  assert.deepEqual(outcome, {
    ok: false,
    failure: { code: "ENGINE_FAILED", stage: "core" },
    pandas_load_ms: null,
  });
});

test("a pandas load that fails is ENGINE_FAILED at the runtime stage", async () => {
  const core = fake_core([
    { ok: false, error: { code: "ANALYSIS_RUNTIME_MISSING", row_index: null } },
  ]);
  core.load_analysis_runtime = async () => {
    throw new Error("Failed to load pandas");
  };
  const outcome = await run_pipeline(core, PAGES_TEXT, null);
  assert.deepEqual(outcome, {
    ok: false,
    failure: { code: "ENGINE_FAILED", stage: "runtime" },
    pandas_load_ms: null,
  });
});

test("a failure after pandas loaded still reports the load time", async () => {
  const core = fake_core([
    { ok: false, error: { code: "ANALYSIS_RUNTIME_MISSING", row_index: null } },
    { ok: false, error: { code: "DATE_UNREADABLE", row_index: 2 } },
  ]);
  const outcome = await run_pipeline(core, PAGES_TEXT, null);
  assert.equal(outcome.failure.core_code, "DATE_UNREADABLE");
  assert.equal(outcome.pandas_load_ms, 12.5);
});
