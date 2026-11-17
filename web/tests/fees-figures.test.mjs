// Fees area figures (IA migration Stage 7c): where every figure on the Fees
// page comes from, and that every door's Ledger scope adds up to the figure it
// opens (DR-10, I-4).
//   Charges paid is the API's `fees.total_fees` (Σ `paid_out` of FEE rows);
//   with rows it must equal them (U-3), or the derived figures are withheld
//   (T-UNVERIFIED). Decision Q-D7: a charge's cause is the transaction it was
//   charged for (DR-2 linkage through its receipt), grouped by that
//   transaction's event type; a charge not linked to one transaction (orphan
//   or ambiguous) is its own cause, never guessed. The causes partition the
//   charges. The share of money out (DR-7) is withheld alone when U-2
//   disagrees. The largest charges open their receipts.
// Oracles come from the fixtures' rows and API fields, not from the app.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/fees-figures.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { prototypeSampleWithBackendAnalytics } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { resolveLedgerScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");
const { share } = await import("../src/lib/statement/totals.ts");
const { feesFigures } = await import("../src/lib/statement/fees.ts");

const CONTRACT = contractFixtures();
const FIXTURES = {
  F1: CONTRACT["F1-worked-example"],
  F5: prototypeSampleWithBackendAnalytics(),
};
/** No FEE rows at all. */
const NO_FEES = CONTRACT["F4-paginated-2345"];
const cents = (amount) => Math.round(amount * 100);
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
const fees = (fixture) => fixture.rows.filter((row) => row.event_type === "FEE");

/** Oracle for Q-D7: the event type of the one non-fee row on a fee's receipt, or "unlinked". */
function causeOf(fixture, fee) {
  const parents = fixture.rows.filter((row) => row.receipt_no === fee.receipt_no && row.event_type !== "FEE");
  return parents.length === 1 ? parents[0].event_type : "unlinked";
}

/** The figures of `fixture`, with its rows loaded unless `rows` says otherwise. */
function figuresOf(fixture, { rows = fixture.rows, analytics = fixture.snapshot.result } = {}) {
  return feesFigures({ summary: fixture.summary, analytics, rows: rows === null ? null : rows.map(toStatementRow) });
}

/** The DR-10 figure of Ledger scope `id` over `fixture`'s rows. */
function scopeFigure(fixture, id) {
  const rows = fixture.rows.map(toStatementRow);
  const scope = resolveLedgerScope(id, rows);
  assert.ok(scope, `scope ${id} resolves`);
  return scopeFigureCents(rows, scope);
}

describe("charges paid (the API's total_fees)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the API's total, equal to the FEE rows, its door adding up to it`, () => {
      const { api, breakdown } = figuresOf(fixture);
      assert.deepEqual(api, { cents: cents(fixture.snapshot.result.fees.total_fees.total_fees), scopeId: "fees" });
      assert.equal(breakdown.status, "shown");
      assert.deepEqual({ cents: breakdown.total.cents, count: breakdown.total.count }, { cents: sum(fees(fixture), "paid_out"), count: fees(fixture).length });
      assert.equal(breakdown.total.cents, api.cents);
      assert.equal(scopeFigure(fixture, "fees"), api.cents);
    });

    test(`${name}: payments out that carried a charge, and the share of money out (U-2)`, () => {
      const { breakdown } = figuresOf(fixture);
      const out = fixture.rows.filter((row) => row.cash_flow_direction === "OUTFLOW");
      const paymentsOut = out.filter((row) => row.event_type !== "FEE");
      const linkedParents = new Set(
        fees(fixture).filter((fee) => causeOf(fixture, fee) !== "unlinked").map((fee) => fixture.rows.find((row) => row.receipt_no === fee.receipt_no && row.event_type !== "FEE").id),
      );
      assert.equal(breakdown.paymentsOut, paymentsOut.length);
      assert.equal(breakdown.chargedPayments, linkedParents.size);
      assert.deepEqual(breakdown.shareOfOut, { verified: true, share: share(breakdown.total.cents, sum(out, "paid_out")) });
    });
  }
});

describe("causes (Q-D7: the transaction each charge was for)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: each cause's charges, largest first and unlinked last, each a door that adds up; together, every charge`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = new Map();
      for (const fee of fees(fixture)) {
        const cause = expected.get(causeOf(fixture, fee)) ?? { cents: 0, count: 0 };
        cause.cents += cents(fee.paid_out);
        cause.count += 1;
        expected.set(causeOf(fixture, fee), cause);
      }
      assert.deepEqual(new Map(breakdown.causes.map((cause) => [cause.cause, { cents: cause.cents, count: cause.count }])), expected);
      const linked = breakdown.causes.filter((cause) => cause.cause !== "unlinked").map((cause) => cause.cents);
      assert.deepEqual(linked, [...linked].sort((a, b) => b - a), "largest first");
      if (expected.has("unlinked")) assert.equal(breakdown.causes.at(-1).cause, "unlinked");
      for (const cause of breakdown.causes) {
        assert.equal(cause.scopeId, `fees:${cause.cause}`);
        assert.equal(scopeFigure(fixture, cause.scopeId), cause.cents, cause.scopeId);
        assert.equal(cause.share, share(cause.cents, breakdown.total.cents));
      }
      assert.equal(breakdown.causes.reduce((total, cause) => total + cause.cents, 0), breakdown.total.cents, "the causes partition the charges");
    });
  }

  test("F1: Paybill, send and withdrawal charges; the orphan (H) and ambiguous (J) charges are not linked, never guessed", () => {
    const { breakdown } = figuresOf(FIXTURES.F1);
    assert.deepEqual(
      breakdown.causes.map((cause) => [cause.cause, cause.cents]),
      [
        ["BILL_PAYMENT", 3000],
        ["WITHDRAWAL", 2900],
        ["TRANSFER_OUT", 1500],
        ["unlinked", 1700],
      ],
    );
    assert.equal(breakdown.unlinkedCount, 2);
  });

  test("F5: the prototype's three causes (sending, withdrawals, Paybill)", () => {
    const { breakdown } = figuresOf(FIXTURES.F5);
    assert.deepEqual(new Set(breakdown.causes.map((cause) => cause.cause)), new Set(["TRANSFER_OUT", "WITHDRAWAL", "BILL_PAYMENT"]));
    assert.equal(breakdown.unlinkedCount, 0);
  });
});

describe("largest charges and free payments", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the largest charges (ties keep statement order), each with its cause and opening its receipt`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = fees(fixture)
        .map((fee, position) => ({ fee, position }))
        .sort((a, b) => cents(b.fee.paid_out) - cents(a.fee.paid_out) || a.position - b.position)
        .slice(0, 5)
        .map(({ fee }) => [fee.receipt_no, cents(fee.paid_out), causeOf(fixture, fee)]);
      assert.deepEqual(breakdown.largest.map((charge) => [charge.receiptNo, charge.cents, charge.cause]), expected);
      for (const charge of breakdown.largest) assert.equal(charge.scopeId, `receipt:${charge.receiptNo}`);
    });

    test(`${name}: payments that carried no charge, out and in`, () => {
      const { breakdown } = figuresOf(fixture);
      const charged = new Set(fees(fixture).map((fee) => fee.receipt_no));
      const free = (direction) => fixture.rows.filter((row) => row.event_type !== "FEE" && row.cash_flow_direction === direction && !charged.has(row.receipt_no)).length;
      assert.deepEqual(breakdown.free, { outCount: free("OUTFLOW"), inCount: free("INFLOW") });
    });
  }
});

describe("treatments (Q-D9) and empty data", () => {
  test("T-LOADFAIL: without rows only the API's total remains", () => {
    const figures = figuresOf(FIXTURES.F5, { rows: null });
    assert.equal(figures.breakdown, null);
    assert.equal(figures.api.cents, 53200);
  });

  test("T-UNVERIFIED: the API's total disagreeing with the FEE rows (U-3) withholds every derived figure", () => {
    const analytics = structuredClone(FIXTURES.F5.snapshot.result);
    analytics.fees.total_fees.total_fees += 1;
    assert.deepEqual(figuresOf(FIXTURES.F5, { analytics }).breakdown, { status: "unverified" });
  });

  test("U-2 disagreeing withholds only the share of money out", () => {
    const analytics = structuredClone(FIXTURES.F5.snapshot.result);
    analytics.cash_flow.total_outflow += 1;
    const { breakdown } = figuresOf(FIXTURES.F5, { analytics });
    assert.equal(breakdown.status, "shown");
    assert.deepEqual(breakdown.shareOfOut, { verified: false, share: null });
  });

  test("no charges (F4): a real zero, no causes, no largest charges", () => {
    const { api, breakdown } = figuresOf(NO_FEES);
    assert.equal(api.cents, 0);
    assert.equal(breakdown.status, "shown");
    assert.deepEqual([breakdown.total.count, breakdown.causes, breakdown.largest], [0, [], []]);
  });
});
