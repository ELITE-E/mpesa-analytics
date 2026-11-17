// Savings & Investments area figures (IA migration Stage 7d): where every
// figure on the Savings page comes from, and that every door's Ledger scope
// adds up to the figure it opens (DR-10, I-4).
//   Set aside is the API's `investments.total_investment` (the engine's
//   INVESTMENT rows, principal); with rows it must equal the Set-aside bucket,
//   or the derived figures are withheld (T-UNVERIFIED). Places are the
//   bucket's rows by exact stored entity (DR-8), as the API's `by_platform`;
//   months as its `monthly_investment`; deposits by principal, each opening
//   its receipt. The share of money in (DR-7) depends on U-1: withheld alone
//   when the rows' inflow disagrees with the API's (Q-D9).
//   Charges linked to deposits are display only (Q-LINK), counted in Fees.
// Oracles come from the fixtures' API fields, not from the app.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/savings-figures.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { prototypeSampleWithBackendAnalytics, savingsEdgeCasesFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { resolveLedgerScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");
const { share } = await import("../src/lib/statement/totals.ts");
const { savingsFigures } = await import("../src/lib/statement/savings.ts");

const CONTRACT = contractFixtures();
const FIXTURES = {
  F1: CONTRACT["F1-worked-example"],
  F5: prototypeSampleWithBackendAnalytics(),
  edge: savingsEdgeCasesFixture(),
};
/** Fixtures whose analytics the backend computed from their rows (F1's are the builder's totals only). */
const BACKEND = ["F5", "edge"];
const EMPTY = CONTRACT["F4-paginated-2345"];
const cents = (amount) => Math.round(amount * 100);
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
const deposits = (fixture) => fixture.rows.filter((row) => row.event_type === "INVESTMENT" && row.cash_flow_direction === "OUTFLOW");

/** The figures of `fixture`, with its rows loaded unless `rows` says otherwise. */
function figuresOf(fixture, { rows = fixture.rows, analytics = fixture.snapshot.result } = {}) {
  return savingsFigures({ summary: fixture.summary, analytics, rows: rows === null ? null : rows.map(toStatementRow) });
}

/** The DR-10 figure of Ledger scope `id` over `fixture`'s rows. */
function scopeFigure(fixture, id) {
  const rows = fixture.rows.map(toStatementRow);
  const scope = resolveLedgerScope(id, rows);
  assert.ok(scope, `scope ${id} resolves`);
  return scopeFigureCents(rows, scope);
}

describe("set aside (the API's total_investment)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the API's total, equal to the Set-aside bucket, its door adding up to it`, () => {
      const figures = figuresOf(fixture);
      assert.equal(figures.api.totalCents, cents(fixture.snapshot.result.investments.total_investment.investment_amount));
      const { breakdown } = figures;
      assert.equal(breakdown.status, "shown");
      assert.deepEqual({ cents: breakdown.total.cents, count: breakdown.total.count }, { cents: sum(deposits(fixture), "paid_out"), count: deposits(fixture).length });
      assert.equal(breakdown.total.cents, figures.api.totalCents);
      assert.equal(breakdown.total.scopeId, "bucket:set-aside");
      assert.equal(scopeFigure(fixture, breakdown.total.scopeId), breakdown.total.cents);
    });

    test(`${name}: the share of money in is DR-7 of the rows' inflow, verified against the API's (U-1)`, () => {
      const { breakdown } = figuresOf(fixture);
      const inflow = fixture.rows.filter((row) => row.cash_flow_direction === "INFLOW");
      assert.equal(sum(inflow, "paid_in"), cents(fixture.snapshot.result.cash_flow.total_inflow), "the fixture agrees on U-1");
      assert.deepEqual(breakdown.shareOfIn, { verified: true, share: share(breakdown.total.cents, sum(inflow, "paid_in")) });
    });
  }

  test("edge: unit-trust deposits only; the money market fund (Paybill) and M-Shwari aren't set aside", () => {
    const { breakdown } = figuresOf(FIXTURES.edge);
    assert.equal(breakdown.total.cents, 950000);
    assert.equal(breakdown.total.count, 4);
    assert.equal(breakdown.shareOfIn.share, 47.5);
    assert.ok(!breakdown.places.some((place) => /Stanbic|M-Shwari/.test(place.entity)));
  });
});

describe("places (DR-8; as the API's by_platform)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: each place's deposits, largest first, each a door to its rows that adds up`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = new Map();
      for (const row of deposits(fixture)) {
        const place = expected.get(row.entity) ?? { cents: 0, count: 0 };
        place.cents += cents(row.paid_out);
        place.count += 1;
        expected.set(row.entity, place);
      }
      assert.deepEqual(new Map(breakdown.places.map((place) => [place.entity, { cents: place.cents, count: place.count }])), expected);
      const amounts = breakdown.places.map((place) => place.cents);
      assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a), "largest first");
      for (const place of breakdown.places) {
        assert.equal(place.scopeId, `group:set-aside:${place.entity}`);
        assert.equal(scopeFigure(fixture, place.scopeId), place.cents, place.scopeId);
        assert.equal(place.share, share(place.cents, breakdown.total.cents));
      }
      if (BACKEND.includes(name)) {
        const api = fixture.snapshot.result.investments.by_platform;
        assert.deepEqual(new Map(api.map((item) => [item.platform, cents(item.amount_invested)])), new Map(breakdown.places.map((place) => [place.entity, place.cents])));
      }
    });
  }

  test("edge: an unidentified platform is 'Not identified' and isn't counted as a place", () => {
    const { breakdown } = figuresOf(FIXTURES.edge);
    const unidentified = breakdown.places.find((place) => place.entity === "NO_ENTITY_IDENTIFIED");
    assert.equal(unidentified.label, "Not identified");
    assert.equal(breakdown.total.places, 2);
  });
});

describe("months and deposits", () => {
  for (const name of BACKEND) {
    test(`${name}: months as the API's monthly_investment, oldest first`, () => {
      const fixture = FIXTURES[name];
      const { breakdown } = figuresOf(fixture);
      assert.deepEqual(
        breakdown.months.map((month) => [month.month, month.cents]),
        fixture.snapshot.result.investments.monthly_investment.map((item) => [item.month, cents(item.investment_amount)]),
      );
      assert.equal(breakdown.months.reduce((total, month) => total + month.count, 0), breakdown.total.count);
    });
  }

  test("a deposit whose time can't be read is counted in its own month, 'null', last", () => {
    const fixture = FIXTURES.edge;
    const rows = structuredClone(fixture.rows);
    rows.find((row) => row.receipt_no === "SYNSA02").completion_time = "not a time";
    const { breakdown } = figuresOf(fixture, { rows });
    assert.deepEqual(breakdown.months.map((month) => [month.month, month.count]), [["2026-08", 1], ["2026-09", 2], [null, 1]]);
  });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the largest deposits by principal (ties keep statement order), each opening its receipt`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = deposits(fixture)
        .map((row, position) => ({ row, position }))
        .sort((a, b) => cents(b.row.paid_out) - cents(a.row.paid_out) || a.position - b.position)
        .slice(0, 5)
        .map(({ row }) => [row.receipt_no, cents(row.paid_out)]);
      assert.deepEqual(breakdown.deposits.map((deposit) => [deposit.receiptNo, deposit.cents]), expected);
      for (const deposit of breakdown.deposits) {
        assert.equal(deposit.scopeId, `receipt:${deposit.receiptNo}`);
        assert.equal(scopeFigure(fixture, deposit.scopeId), deposit.cents + deposit.chargeCents, deposit.receiptNo);
      }
    });

    test(`${name}: charges linked to deposits, display only (Q-LINK)`, () => {
      const { breakdown } = figuresOf(fixture);
      const linked = fixture.rows.filter((fee) => {
        if (fee.event_type !== "FEE") return false;
        const parents = fixture.rows.filter((row) => row.receipt_no === fee.receipt_no && row.event_type !== "FEE");
        return parents.length === 1 && deposits(fixture).includes(parents[0]);
      });
      assert.deepEqual(breakdown.depositCharges, { cents: sum(linked, "paid_out"), count: new Set(linked.map((fee) => fee.receipt_no)).size });
    });
  }
});

describe("treatments (Q-D9) and empty data", () => {
  test("T-LOADFAIL: without rows only the API's total remains", () => {
    const figures = figuresOf(FIXTURES.F5, { rows: null });
    assert.equal(figures.breakdown, null);
    assert.equal(figures.api.totalCents, 500000);
  });

  test("T-UNVERIFIED: the API's total disagreeing with the rows withholds every derived figure", () => {
    const analytics = structuredClone(FIXTURES.F5.snapshot.result);
    analytics.investments.total_investment.investment_amount += 1;
    assert.deepEqual(figuresOf(FIXTURES.F5, { analytics }).breakdown, { status: "unverified" });
  });

  test("U-1 disagreeing withholds only the share of money in", () => {
    const analytics = structuredClone(FIXTURES.F5.snapshot.result);
    analytics.cash_flow.total_inflow += 1;
    const { breakdown } = figuresOf(FIXTURES.F5, { analytics });
    assert.equal(breakdown.status, "shown");
    assert.deepEqual(breakdown.shareOfIn, { verified: false, share: null });
    assert.equal(breakdown.total.cents, 500000);
  });

  test("nothing set aside (F4): a real zero, no places, no months, no deposits", () => {
    const { breakdown, api } = figuresOf(EMPTY);
    assert.deepEqual(api, { totalCents: 0 });
    assert.equal(breakdown.status, "shown");
    assert.deepEqual(breakdown.total, { cents: 0, count: 0, places: 0, scopeId: "bucket:set-aside" });
    assert.deepEqual([breakdown.places, breakdown.months, breakdown.deposits], [[], [], []]);
  });
});
