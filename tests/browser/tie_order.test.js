// CP8a-3: on a statement full of tied amounts and times (F-TIED, generated, never committed), the
// browser's report equals CPython's for every ordering by value in the analysis. Before CP8a-3 the
// unstable pandas sorts put ties in a different order on x86 (SIMD) and in wasm.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  open_session,
  run_in_browser,
  run_in_cpython,
} from "../../tools/browser/browser_session.js";

const REPO = join(import.meta.dirname, "../..");
const PROCESSED_AT = "2026-11-16T09:00:00Z";
const scratch = mkdtempSync(join(tmpdir(), "f-tied-"));
let browserReport;
let cpythonReport;
let transactions;

before(async () => {
  const python = join(REPO, ".venv/bin/python");
  const generator = join(REPO, "tools/synth/generate.py");
  const ran = spawnSync(python, [generator, "--name", "F-TIED", "--out-dir", scratch], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr);
  const session = await open_session();
  try {
    const outcome = await run_in_browser(
      session,
      new Uint8Array(readFileSync(join(scratch, "F-TIED.pdf"))),
      { include_statement_pages: true, processed_at: PROCESSED_AT },
    );
    assert.equal(outcome.ok, true, JSON.stringify(outcome.failure));
    const browserResult = JSON.parse(outcome.pipeline_result_json);
    browserReport = browserResult.report;
    transactions = browserResult.transactions;
    const [envelope] = run_in_cpython([
      { statement_pages_json: outcome.statement_pages_json, processed_at: PROCESSED_AT },
    ]);
    assert.equal(envelope.ok, true);
    cpythonReport = envelope.pipeline_result.report;
  } finally {
    await session.close();
  }
});

after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Tell whether a list of numbers holds a repeat.
 *
 * @param {number[]} values The numbers.
 * @returns {boolean} True if any value appears twice.
 */
function has_repeat(values) {
  return new Set(values).size < values.length;
}

test("the tied fixture really ties every ordering it is meant to test", () => {
  const spending = cpythonReport.spending;
  assert.ok(has_repeat(spending.largest_purchases.map((entry) => entry.amount)));
  assert.ok(has_repeat(spending.top_recipients.map((entry) => entry.amount_received)));
  const times = transactions.map((transaction) => transaction.completion_time).sort();
  assert.equal(times.at(-1), times.at(-2), "latest completion time is shared");
});

test("largest purchases are the same, in the same order, in the browser and CPython", () => {
  assert.deepEqual(
    browserReport.spending.largest_purchases,
    cpythonReport.spending.largest_purchases,
  );
});

test("top recipients are the same, in the same order, in the browser and CPython", () => {
  assert.deepEqual(browserReport.spending.top_recipients, cpythonReport.spending.top_recipients);
});

test("the closing balance on a tied latest time is the same in the browser and CPython", () => {
  assert.equal(browserReport.cash_flow.closing_balance, cpythonReport.cash_flow.closing_balance);
});

test("the orderings that were already stable stay equal too", () => {
  for (const [section, key] of [
    ["spending", "merchant_usage_frequency"],
    ["spending", "recurring_purchases"],
    ["transfers", "by_recipient_count"],
    ["transfers", "largest_transfers"],
  ]) {
    assert.deepEqual(browserReport[section][key], cpythonReport[section][key], `${section}.${key}`);
  }
});

test("the whole report is the same in the browser and CPython", () => {
  assert.deepEqual(browserReport, cpythonReport);
});
