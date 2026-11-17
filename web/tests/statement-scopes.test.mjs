// Statement domain, Ledger scopes (IA migration Stage 4b; plan rev1 DR-10,
// I-4): a scope is a set of rows, `FEE` rows members in their own right, with
// one measure: `in` (Σ paid_in), `out` (Σ paid_out of non-fee members),
// `charges` (Σ paid_out of fee members), `out+charges`, or `both` (no single
// figure). Every figure equals the measure of the scope it opens (I-4).
// Scope IDs for Ledger URLs are decided with Q-R2 in Stage 5, not here.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-scopes.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { inflowSources, outflowAllocation } = await import("../src/lib/statement/totals.ts");
const { groupsInBucket } = await import("../src/lib/statement/groups.ts");
const { bucketScope, groupScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");

const f1Rows = contractFixtures()["F1-worked-example"].rows.map(toStatementRow);

describe("DR-10 scope measures", () => {
  // F1 rows 7 (bill payment, 2,000.00) and 8 (its fee, 30.00), plus the
  // inflow row 1 (10,000.00): the shape of a receipt scope with a mixed row.
  const receiptRows = { rowIds: [7, 8] };

  test("`out` counts non-fee members only; `charges` only the fee members", () => {
    assert.equal(scopeFigureCents(f1Rows, { ...receiptRows, measure: "out" }), 200000);
    assert.equal(scopeFigureCents(f1Rows, { ...receiptRows, measure: "charges" }), 3000);
    assert.equal(scopeFigureCents(f1Rows, { ...receiptRows, measure: "out+charges" }), 203000);
  });

  test("`in` counts paid_in; `both` has no single figure", () => {
    assert.equal(scopeFigureCents(f1Rows, { rowIds: [1, 6], measure: "in" }), 1000000);
    assert.equal(scopeFigureCents(f1Rows, { rowIds: [1, 6], measure: "both" }), null);
  });

  test("an empty scope measures zero, not null", () => {
    assert.equal(scopeFigureCents(f1Rows, { rowIds: [], measure: "out" }), 0);
  });
});

describe("I-4 every figure equals the measure of the scope it opens", () => {
  test("allocation buckets, Charges included, with the fee rows as members", () => {
    for (const total of outflowAllocation(f1Rows)) {
      const scope = bucketScope(f1Rows, total.bucket);
      assert.deepEqual(scope.rowIds, total.rowIds, total.bucket);
      assert.equal(scope.measure, total.bucket === "charges" ? "charges" : "out", total.bucket);
      assert.equal(scopeFigureCents(f1Rows, scope), total.cents, total.bucket);
    }
  });

  test("inflow sources", () => {
    for (const total of inflowSources(f1Rows)) {
      const scope = bucketScope(f1Rows, total.bucket);
      assert.equal(scope.measure, "in");
      assert.equal(scopeFigureCents(f1Rows, scope), total.cents, total.bucket);
    }
  });

  test("entity groups (DR-8)", () => {
    for (const bucket of ["sent-to-people", "not-classified-out", "from-people"]) {
      for (const group of groupsInBucket(f1Rows, bucket)) {
        assert.equal(scopeFigureCents(f1Rows, groupScope(group, bucket)), group.cents, `${bucket} ${group.entity}`);
      }
    }
  });
});
