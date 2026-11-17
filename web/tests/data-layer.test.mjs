// CP8b item 2: the data layer (src/data/) gives the UI the shapes the old API gave it, built from
// the local engine's output. The frontend's own toStatementRow and compareWithApi run on core
// output from every synthetic fixture with 0 failures.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/data-layer.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { coreFixtures, FIXTURES_WITH_ROWS, PROCESSED_AT } from "./support/core-fixtures.mjs";

const { toCreatedImport, toImportSummary, toTransactions, toAnalyticsSnapshot } = await import(
  "../src/data/adapter.ts"
);
const { ENGINE_CODES, CORE_CODES, messageFor, toApiError } = await import("../src/data/messages.ts");
const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { compareWithApi } = await import("../src/lib/statement/totals.ts");
const repo = await import("../src/data/repo.ts");

const fixtures = coreFixtures(FIXTURES_WITH_ROWS);

test("transactions carry the old API's field names, with status as transaction_status", () => {
  const { pipeline_result: result } = fixtures["F-GOLDEN"];
  const transactions = toTransactions(7, result);
  assert.equal(transactions.length, result.transactions.length);
  const [first] = transactions;
  assert.equal(first.transaction_status, result.transactions[0].status);
  assert.equal("status" in first, false);
  for (const field of [
    "receipt_no",
    "completion_time",
    "details",
    "event_type",
    "paid_in",
    "paid_out",
    "total_cost",
    "balance",
    "cash_flow_direction",
    "economic_meaning",
  ]) {
    assert.equal(first[field], result.transactions[0][field], field);
  }
  assert.equal(typeof first.entity, "string");
});

test("every transaction has a stable local id, unique across imports", () => {
  const { pipeline_result: result } = fixtures["F-GOLDEN"];
  const first = toTransactions(1, result).map((row) => row.id);
  assert.deepEqual(toTransactions(1, result).map((row) => row.id), first);
  assert.equal(new Set(first).size, first.length);
  const second = toTransactions(2, result).map((row) => row.id);
  assert.equal(second.some((id) => first.includes(id)), false);
});

test("the import summary is built from the pipeline result, quality and the import plan", () => {
  const { pipeline_result: result, plan } = fixtures["F-GOLDEN"];
  const summary = toImportSummary(3, result, plan);
  assert.deepEqual(summary, {
    id: 3,
    imported_at: PROCESSED_AT,
    period_start: result.period.start,
    period_end: result.period.end,
    status: "completed",
    transaction_count: result.transactions.length,
    previously_imported_transaction_count: plan.counts.link,
    unclassified_transaction_count: result.quality.unclassified_rows,
    observation_counts: plan.counts.preserve ? { COLLISION: plan.counts.preserve } : {},
  });
});

test("a created import holds the summary, the report as analytics, and the verification token", () => {
  const { pipeline_result: result, plan } = fixtures["F-GOLDEN"];
  const created = toCreatedImport(4, result, plan);
  assert.deepEqual(created.import, toImportSummary(4, result, plan));
  assert.deepEqual(created.analytics, result.report);
  assert.equal(created.verification_token, result.verification_token);
  const snapshot = toAnalyticsSnapshot(4, result);
  assert.equal(snapshot.import_id, 4);
  assert.deepEqual(snapshot.result, result.report);
});

for (const name of FIXTURES_WITH_ROWS) {
  test(`${name}: toStatementRow and compareWithApi agree with the core's report`, () => {
    const { pipeline_result: result } = fixtures[name];
    const rows = toTransactions(1, result).map(toStatementRow);
    const comparison = compareWithApi(rows, result.report);
    for (const [figure, outcome] of Object.entries(comparison)) {
      assert.equal(outcome.agrees, true, `${name} ${figure}: ${outcome.rowsCents} vs ${outcome.apiCents}`);
    }
  });
}

test("every engine code and every core code has its own message", () => {
  const codes = [...ENGINE_CODES, ...CORE_CODES];
  const messages = codes.map((code) => messageFor(code));
  for (const [index, message] of messages.entries()) {
    assert.equal(typeof message, "string", codes[index]);
    assert.ok(message.length > 20, codes[index]);
  }
  assert.equal(new Set(messages).size, messages.length);
});

test("the engine's codes and the core's codes are all covered", () => {
  for (const code of [
    "NOT_A_PDF",
    "PASSWORD_REQUIRED",
    "PASSWORD_INCORRECT",
    "CORRUPT_PDF",
    "TOO_LARGE",
    "TOO_MANY_PAGES",
    "TIMEOUT",
    "LAYOUT_UNRECOGNIZED",
    "ENGINE_FAILED",
  ]) {
    assert.ok(ENGINE_CODES.includes(code), code);
  }
  for (const code of [
    "NO_PAGES",
    "BRAND_MISSING",
    "ANCHOR_MISSING",
    "TOKEN_MISSING",
    "DOMAIN_ROW",
    "DATE_UNREADABLE",
    "ANALYSIS_FAILED",
  ]) {
    assert.ok(CORE_CODES.includes(code), code);
  }
});

test("an engine failure becomes an ApiError with the most specific code and its message", () => {
  const notStatement = toApiError({ code: "LAYOUT_UNRECOGNIZED", stage: "core", core_code: "BRAND_MISSING" });
  assert.ok(notStatement instanceof repo.ApiError);
  assert.equal(notStatement.code, "BRAND_MISSING");
  assert.equal(notStatement.message, messageFor("BRAND_MISSING"));
  const tooLarge = toApiError({ code: "TOO_LARGE", stage: "reader" });
  assert.equal(tooLarge.code, "TOO_LARGE");
  assert.equal(tooLarge.isRetryable, false);
  assert.equal(toApiError({ code: "TIMEOUT", stage: "engine" }).isRetryable, true);
});

test("the repo keeps imports in memory and answers the UI's calls from them", async () => {
  const { pipeline_result: result, plan } = fixtures["F-BASIC"];
  const engine = {
    async run() {
      return {
        ok: true,
        pipeline_result_json: JSON.stringify(result),
        plan_json: JSON.stringify(plan),
        timings: {},
      };
    },
  };
  repo.useEngineForTests(engine);
  assert.equal(await repo.getImportOrLatest(null), null);
  const created = await repo.uploadStatement(new File([new Uint8Array([0x25])], "statement.pdf"), "");
  assert.deepEqual((await repo.listImports(1)).items, [created.import]);
  assert.deepEqual(await repo.getImport(created.import.id), created.import);
  assert.deepEqual(await repo.getImportOrLatest(null), created.import);
  assert.deepEqual((await repo.getAnalytics(created.import.id)).result, result.report);
  assert.equal((await repo.getAllTransactions(created.import.id)).length, result.transactions.length);
  await assert.rejects(repo.getImport(created.import.id + 99), { code: "import_not_found" });
});

test("an engine failure from upload rejects with that code's ApiError", async () => {
  repo.useEngineForTests({
    async run() {
      return { ok: false, failure: { code: "PASSWORD_INCORRECT", stage: "reader" } };
    },
  });
  await assert.rejects(repo.uploadStatement(new File([new Uint8Array([0x25])], "s.pdf"), "x"), {
    code: "PASSWORD_INCORRECT",
    message: messageFor("PASSWORD_INCORRECT"),
  });
});
