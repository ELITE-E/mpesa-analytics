// Statement domain, charges (IA migration Stage 4b; plan rev2 R1.2, rev1 I-3):
//   DR-2 a `FEE` row is linked iff exactly one non-`FEE` row in the import
//        shares its `receipt_no`; otherwise it is an orphan (no candidate) or
//        ambiguous (two or more). Linkage is for display only: it never
//        changes a row, a principal or a bucket.
//   I-3  charges = linked charges + unlinked charges = `fees.total_fees`.
// Fixture F1 (rev1 §1.5) has three linked fees, one orphan and one ambiguous.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-charges.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { linkCharges, linkedChargesByParent, summarizeCharges } = await import("../src/lib/statement/charges.ts");

const FIXTURES = contractFixtures();
const F1 = FIXTURES["F1-worked-example"];
const rows = F1.rows.map(toStatementRow);

describe("DR-2 charge linkage", () => {
  const links = linkCharges(rows);

  test("links a fee to the only non-fee row on its receipt", () => {
    assert.deepEqual(
      links.filter((link) => link.status === "linked"),
      [
        { feeId: 8, status: "linked", parentId: 7 },
        { feeId: 10, status: "linked", parentId: 9 },
        { feeId: 12, status: "linked", parentId: 11 },
      ],
    );
  });

  test("leaves a fee with no candidate parent as an orphan", () => {
    assert.deepEqual(links.find((link) => link.feeId === 16), { feeId: 16, status: "orphan" });
  });

  test("leaves a fee with several candidate parents ambiguous, naming them", () => {
    assert.deepEqual(links.find((link) => link.feeId === 20), { feeId: 20, status: "ambiguous", candidateIds: [18, 19] });
  });

  test("describes every fee row exactly once and nothing else", () => {
    assert.deepEqual(links.map((link) => link.feeId), rows.filter((row) => row.isCharge).map((row) => row.id));
  });

  test("links a fee that shares its parent's time (F2)", () => {
    const f2 = FIXTURES["F2-tied-timestamps"].rows.map(toStatementRow);
    const fee = f2.find((row) => row.isCharge);
    const [link] = linkCharges(f2);
    const parent = f2.find((row) => row.id === link.parentId);
    assert.equal(link.status, "linked");
    assert.equal(parent.receiptNo, fee.receiptNo);
    assert.equal(parent.source.completion_time, fee.source.completion_time);
  });

  test("never changes a row, a principal or a bucket", () => {
    const before = JSON.stringify(rows);
    linkCharges(rows);
    assert.equal(JSON.stringify(rows), before);
  });
});

describe("I-3 charges reconcile", () => {
  const links = linkCharges(rows);

  test("splits the charges into linked and unlinked, which add up to total_fees", () => {
    const summary = summarizeCharges(rows, links);
    assert.deepEqual(summary, {
      totalCents: 9100,
      linkedCents: 7400,
      orphanCents: 1000,
      ambiguousCents: 700,
      unlinkedCount: 2,
    });
    assert.equal(summary.linkedCents + summary.orphanCents + summary.ambiguousCents, summary.totalCents);
    assert.equal(summary.totalCents, Math.round(F1.snapshot.result.fees.total_fees.total_fees * 100));
  });

  test("gives each parent only the charges linked to it", () => {
    assert.deepEqual([...linkedChargesByParent(rows, links)], [[7, 3000], [9, 1500], [11, 2900]]);
  });

  test("an import without charges has none of either kind", () => {
    const noFees = FIXTURES["F4-paginated-2345"].rows.map(toStatementRow);
    assert.deepEqual(summarizeCharges(noFees, linkCharges(noFees)), {
      totalCents: 0,
      linkedCents: 0,
      orphanCents: 0,
      ambiguousCents: 0,
      unlinkedCount: 0,
    });
  });
});
