// Statement domain, totals (IA migration Stage 4b; plan rev1 §1.2, §1.4, §1.5;
// rev2 R2 U-1..U-3):
//   DR-5 outflow allocation: OUTFLOW rows partitioned by DR-3 bucket, every
//        `FEE` row (linked or not) in Charges, measure Σ paid_out;
//   DR-6 inflow sources: INFLOW rows partitioned by DR-3, measure Σ paid_in;
//   DR-7 shares: part ÷ whole × 100, 1 dp half-up, a zero whole → null;
//   DR-9 daily average: principal ÷ inclusive days of the period;
//   I-1 Σ allocation = total_outflow, I-2 Σ sources = total_inflow,
//   I-3 Charges = total_fees, I-5 only `FEE` rows in Charges. Against the API
//   these are comparisons (rev2 U-1..U-3), reported, never forced.
// The F1 figures are rev1 §1.5's worked example.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-totals.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { compareWithApi, dailyAverageCents, inflowSources, outflowAllocation, share } = await import("../src/lib/statement/totals.ts");

const FIXTURES = contractFixtures();
const F1 = FIXTURES["F1-worked-example"];
const f1Rows = F1.rows.map(toStatementRow);
const cents = (amount) => Math.round(amount * 100);
const sum = (totals) => totals.reduce((total, bucket) => total + bucket.cents, 0);

describe("DR-5 outflow allocation", () => {
  test("partitions F1's outflows into rev1 §1.5's buckets", () => {
    assert.deepEqual(outflowAllocation(f1Rows), [
      { bucket: "spending", cents: 300000, rowIds: [6, 7] },
      { bucket: "airtime", cents: 10000, rowIds: [14] },
      { bucket: "sent-to-people", cents: 180000, rowIds: [9, 18] },
      { bucket: "set-aside", cents: 500000, rowIds: [13] },
      { bucket: "cash-withdrawn", cents: 300000, rowIds: [11] },
      { bucket: "not-classified-out", cents: 45000, rowIds: [15, 19] },
      { bucket: "reversals-out", cents: 20000, rowIds: [17] },
      { bucket: "charges", cents: 9100, rowIds: [8, 10, 12, 16, 20] },
    ]);
  });

  test("I-1 adds up to total_outflow exactly (F1, F4, F5)", () => {
    for (const name of ["F1-worked-example", "F4-paginated-2345", "F5-prototype-converted"]) {
      const fixture = FIXTURES[name];
      assert.equal(sum(outflowAllocation(fixture.rows.map(toStatementRow))), cents(fixture.snapshot.result.cash_flow.total_outflow), name);
    }
  });

  test("I-3 and I-5: Charges holds exactly the fee rows and equals total_fees", () => {
    const charges = outflowAllocation(f1Rows).find((bucket) => bucket.bucket === "charges");
    assert.deepEqual(charges.rowIds, f1Rows.filter((row) => row.isCharge).map((row) => row.id));
    assert.equal(charges.cents, cents(F1.snapshot.result.fees.total_fees.total_fees));
    for (const bucket of outflowAllocation(f1Rows).filter((b) => b.bucket !== "charges")) {
      assert.ok(bucket.rowIds.every((id) => !f1Rows.find((row) => row.id === id).isCharge), bucket.bucket);
    }
  });

  test("each outflow row is in exactly one bucket", () => {
    const ids = outflowAllocation(f1Rows).flatMap((bucket) => bucket.rowIds);
    assert.deepEqual([...ids].sort((a, b) => a - b), f1Rows.filter((row) => row.direction === "out").map((row) => row.id));
  });

  test("an import without rows allocates nothing", () => {
    assert.deepEqual(outflowAllocation([]), []);
    assert.deepEqual(inflowSources([]), []);
  });
});

describe("DR-6 inflow sources", () => {
  test("partitions F1's inflows into rev1 §1.5's sources", () => {
    assert.deepEqual(inflowSources(f1Rows), [
      { bucket: "from-people", cents: 1000000, rowIds: [1] },
      { bucket: "cash-deposits", cents: 500000, rowIds: [2] },
      { bucket: "reversals-in", cents: 100000, rowIds: [3] },
      { bucket: "not-classified-in", cents: 25000, rowIds: [4] },
      { bucket: "other-in", cents: 8000, rowIds: [5] },
    ]);
  });

  test("I-2 adds up to total_inflow exactly (F1, F4, F5)", () => {
    for (const name of ["F1-worked-example", "F4-paginated-2345", "F5-prototype-converted"]) {
      const fixture = FIXTURES[name];
      assert.equal(sum(inflowSources(fixture.rows.map(toStatementRow))), cents(fixture.snapshot.result.cash_flow.total_inflow), name);
    }
  });
});

describe("comparison with the API's totals (U-1..U-3)", () => {
  test("agrees for F1", () => {
    assert.deepEqual(compareWithApi(f1Rows, F1.snapshot.result), {
      inflow: { rowsCents: 1633000, apiCents: 1633000, agrees: true },
      outflow: { rowsCents: 1364100, apiCents: 1364100, agrees: true },
      charges: { rowsCents: 9100, apiCents: 9100, agrees: true },
    });
  });

  test("reports a difference with both values instead of adjusting either", () => {
    // F1 without one stored row, as when materially identical rows collapse (rev2 V-3).
    const collapsed = f1Rows.filter((row) => row.id !== 9);
    assert.deepEqual(compareWithApi(collapsed, F1.snapshot.result).outflow, { rowsCents: 1214100, apiCents: 1364100, agrees: false });
  });
});

describe("DR-7 shares", () => {
  test("rounds to one decimal place, half up", () => {
    assert.equal(share(300000, 1364100), 22);
    assert.equal(share(1, 8), 12.5);
    assert.equal(share(1, 16), 6.3);
    assert.equal(share(1, 3), 33.3);
    assert.equal(share(2, 3), 66.7);
  });

  // In tenths of a percent the share is 1000·part/whole, rounded half up.
  test("rounds an exact half-way point up and a value just below it down", () => {
    // 1000 × 12,500 / 200,000 = 62.5 exactly → 63 tenths.
    assert.equal(share(12500, 200000), 6.3);
    // 1000 × 12,499 / 200,000 = 62.495 → 62 tenths.
    assert.equal(share(12499, 200000), 6.2);
    // 2000 × 4 = 7 × 1,143 − 1: 1000 × 4 / 1,143 = 3.5 − 1/2,286, the closest a
    // whole of 1,143 cents can come below a half-way point → 3 tenths.
    assert.equal(share(4, 1143), 0.3);
  });

  test("stays exact where floating-point division would cross a half-way point", () => {
    // 1000·p/w lies 1/(2w) below 451.5 (2000p = 903·w − 1): exactly 45.1, but a
    // double quotient of 2000p + w over 2w rounds up to 452 tenths.
    assert.equal(share(4515000000256, 10000000000567), 45.1);
    // 1000·p/w lies 1/(2w) below 513.5 (2000p = 1027·w − 1): exactly 51.3, but
    // Math.round of the double quotient 1000p/w gives 514 tenths.
    assert.equal(share(5135000001008, 10000000001963), 51.3);
  });

  test("is null, not 0%, when the whole is zero", () => {
    assert.equal(share(0, 0), null);
  });
});

describe("DR-9 daily average", () => {
  test("divides by the inclusive days of the period", () => {
    assert.equal(dailyAverageCents(3100, "2024-07-01", "2024-07-31"), 100);
    assert.equal(dailyAverageCents(5000, "2026-07-01", "2026-07-01"), 5000);
  });

  test("is null for a period that isn't a valid date range", () => {
    assert.equal(dailyAverageCents(5000, "2026-07-02", "2026-07-01"), null);
    assert.equal(dailyAverageCents(5000, "not a date", "2026-07-01"), null);
  });
});
