// Overview figures (IA migration Stage 6): where every figure on Overview
// comes from, and that every door's Ledger scope adds up to the figure it
// opens (DR-10, I-4).
//   API values (rev2 R2.3): money in/out, net, closing, statement lines
//     (Q-D5), unclassified count, largest purchases (Q-D4, incl. charges);
//   rows (Stage 4b model): outflow allocation (DR-5), sources (DR-6), shares
//     (DR-7), opening balance O1 with the O2 check (DR-4, Q-D6), unclassified
//     amounts, largest inflow and send (Q-D4);
//   treatments (Q-D9): without rows every row-derived figure is null
//     (T-LOADFAIL); a U-1..U-3 disagreement withholds only the breakdown that
//     depends on it (T-UNVERIFIED).
// Oracles come from the fixtures' API fields and rows, not from the app.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/overview-figures.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { prototypeSampleWithBackendAnalytics, stressOverviewFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { resolveLedgerScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");
const { share } = await import("../src/lib/statement/totals.ts");
const { overviewFigures } = await import("../src/lib/statement/overview.ts");

const CONTRACT = contractFixtures();
const FIXTURES = {
  F1: CONTRACT["F1-worked-example"],
  F2: CONTRACT["F2-tied-timestamps"],
  F5: prototypeSampleWithBackendAnalytics(),
  stress: stressOverviewFixture(),
};
const cents = (amount) => Math.round(amount * 100);

/** The figures of `fixture`, with its rows loaded unless `rows` says otherwise. */
function figuresOf(fixture, { rows = fixture.rows, analytics = fixture.snapshot.result, summary = fixture.summary } = {}) {
  return overviewFigures({ summary, analytics, rows: rows === null ? null : rows.map(toStatementRow) });
}

/** The DR-10 figure of Ledger scope `id` over `fixture`'s rows. */
function scopeFigure(fixture, id) {
  const rows = fixture.rows.map(toStatementRow);
  const scope = resolveLedgerScope(id, rows);
  assert.ok(scope, `scope ${id} resolves`);
  return scopeFigureCents(rows, scope);
}

/** `fixture` with its analytics' `section.field` replaced by `value`. */
function withAnalytics(fixture, section, field, value) {
  const result = structuredClone(fixture.snapshot.result);
  result[section][field] = value;
  return result;
}

describe("API figures (rev2 R2.3)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: money in, out, net, closing and statement lines are the API's`, () => {
      const figures = figuresOf(fixture);
      const flow = fixture.snapshot.result.cash_flow;
      assert.equal(figures.moneyIn.cents, cents(flow.total_inflow));
      assert.equal(figures.moneyOut.cents, cents(flow.total_outflow));
      assert.equal(figures.netCents, cents(flow.net_cash_flow));
      assert.equal(figures.closingCents, cents(flow.closing_balance));
      assert.equal(figures.lineCount, fixture.summary.transaction_count);
      assert.equal(figures.review.apiCount, fixture.summary.unclassified_transaction_count);
    });
  }

  test("largest purchases are the API's top 3, amounts incl. charges as calculated at import (Q-D4)", () => {
    for (const fixture of [FIXTURES.F5, FIXTURES.stress]) {
      const api = fixture.snapshot.result.spending.largest_purchases.slice(0, 3);
      assert.ok(api.length > 0);
      assert.deepEqual(
        figuresOf(fixture).largest.purchases.map(({ receiptNo, entity, cents: amount, time }) => ({ receiptNo, entity, amount, time })),
        api.map((item) => ({ receiptNo: item.transaction, entity: item.recipient, amount: cents(item.amount), time: item.date })),
      );
    }
  });
});

describe("every door's Ledger scope adds up to its figure (DR-10, I-4)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: money in and money out`, () => {
      const figures = figuresOf(fixture);
      assert.equal(scopeFigure(fixture, figures.moneyIn.scopeId), figures.moneyIn.cents);
      assert.equal(scopeFigure(fixture, figures.moneyOut.scopeId), figures.moneyOut.cents);
    });

    test(`${name}: every allocation bucket and source, whose shares are DR-7's and which add up to the totals (I-1, I-2)`, () => {
      const figures = figuresOf(fixture);
      for (const [breakdown, total] of [[figures.allocation, figures.moneyOut.cents], [figures.sources, figures.moneyIn.cents]]) {
        assert.equal(breakdown.status, "shown");
        assert.equal(breakdown.totalCents, total);
        assert.equal(breakdown.items.reduce((sum, item) => sum + item.cents, 0), total);
        for (const item of breakdown.items) {
          assert.equal(scopeFigure(fixture, item.scopeId), item.cents, item.scopeId);
          assert.equal(item.share, share(item.cents, total), item.scopeId);
        }
      }
    });

    test(`${name}: the unclassified rows, per direction`, () => {
      const figures = figuresOf(fixture);
      const members = fixture.rows.filter((row) => row.event_type === "UNCLASSIFIED");
      assert.deepEqual(figures.review.rows, {
        count: members.length,
        inCents: members.reduce((sum, row) => sum + cents(row.paid_in), 0),
        outCents: members.reduce((sum, row) => sum + cents(row.paid_out), 0),
        scopeId: "unclassified",
      });
      assert.equal(resolveLedgerScope("unclassified", fixture.rows.map(toStatementRow)).rowIds.length, members.length);
    });
  }

  test("a largest purchase's receipt adds up to its amount when the receipt holds one transaction", () => {
    for (const fixture of [FIXTURES.F5, FIXTURES.stress]) {
      for (const purchase of figuresOf(fixture).largest.purchases) {
        const transactions = fixture.rows.filter((row) => row.receipt_no === purchase.receiptNo && row.event_type !== "FEE");
        assert.equal(transactions.length, 1, purchase.receiptNo);
        assert.equal(scopeFigure(fixture, purchase.scopeId), purchase.cents, purchase.receiptNo);
      }
    }
  });

  test("the largest inflow and send are the rows' largest by principal, ties to the earliest; their receipt adds up to principal plus charge", () => {
    for (const fixture of [FIXTURES.F1, FIXTURES.F5]) {
      const rows = fixture.rows;
      const largest = (members) => members.reduce((best, row) => (best === null || row.amount > best.amount ? row : best), null);
      const inflow = largest(rows.filter((row) => row.cash_flow_direction === "INFLOW" && row.event_type !== "FEE").map((row) => ({ ...row, amount: cents(row.paid_in) })));
      const send = largest(rows.filter((row) => row.cash_flow_direction === "OUTFLOW" && row.event_type === "TRANSFER_OUT").map((row) => ({ ...row, amount: cents(row.paid_out) })));
      const derived = figuresOf(fixture).largest.derived;
      assert.deepEqual(derived.map((event) => [event.kind, event.receiptNo, event.cents]), [
        ["inflow", inflow.receipt_no, inflow.amount],
        ["send", send.receipt_no, send.amount],
      ]);
      for (const event of derived) {
        const charges = rows.filter((row) => row.receipt_no === event.receiptNo && row.event_type === "FEE");
        const sole = rows.filter((row) => row.receipt_no === event.receiptNo && row.event_type !== "FEE").length === 1;
        assert.equal(event.chargeCents, sole ? charges.reduce((sum, row) => sum + cents(row.paid_out), 0) : 0, event.receiptNo);
        if (sole) assert.equal(scopeFigure(fixture, event.scopeId), event.cents + event.chargeCents, event.receiptNo);
      }
    }
  });
});

describe("cash-flow bridge: O1 shown, O2 the check (DR-4, Q-D6)", () => {
  test("agrees when the earliest row's balance gives the same opening (F5, stress)", () => {
    for (const fixture of [FIXTURES.F5, FIXTURES.stress]) {
      const { opening } = figuresOf(fixture).bridge;
      const flow = fixture.snapshot.result.cash_flow;
      assert.equal(opening.check, "agrees");
      assert.equal(opening.o1Cents, cents(flow.closing_balance) - cents(flow.total_inflow) + cents(flow.total_outflow));
    }
  });

  test("reports a mismatch with both values, never adjusting either", () => {
    const fixture = FIXTURES.F5;
    const flow = fixture.snapshot.result.cash_flow;
    const analytics = withAnalytics(fixture, "cash_flow", "closing_balance", flow.closing_balance + 50);
    const { opening } = figuresOf(fixture, { analytics }).bridge;
    assert.equal(opening.check, "mismatch");
    assert.equal(opening.o2.status, "computed");
    assert.equal(opening.o1Cents - opening.o2.cents, 5000);
  });

  test("is not checked when the earliest time is tied (F2)", () => {
    const { opening } = figuresOf(FIXTURES.F2).bridge;
    assert.equal(opening.check, "not-checked");
    assert.deepEqual(opening.o2, { status: "unavailable", reason: "tied-earliest-time" });
  });
});

describe("treatments (Q-D9)", () => {
  test("T-LOADFAIL: without rows, every row-derived figure is null and the API's stay", () => {
    const figures = figuresOf(FIXTURES.F5, { rows: null });
    assert.equal(figures.bridge, null);
    assert.equal(figures.allocation, null);
    assert.equal(figures.sources, null);
    assert.equal(figures.review.rows, null);
    assert.equal(figures.review.countsAgree, null);
    assert.equal(figures.largest.derived, null);
    assert.equal(figures.moneyIn.cents, cents(FIXTURES.F5.snapshot.result.cash_flow.total_inflow));
    assert.equal(figures.largest.purchases.length, 3);
  });

  test("T-UNVERIFIED: U-2 or U-3 disagreeing withholds the allocation only; U-1 the sources only", () => {
    const fixture = FIXTURES.F5;
    const flow = fixture.snapshot.result.cash_flow;
    const outflow = figuresOf(fixture, { analytics: withAnalytics(fixture, "cash_flow", "total_outflow", flow.total_outflow + 1) });
    assert.equal(outflow.allocation.status, "unverified");
    assert.equal(outflow.sources.status, "shown");
    const fees = withAnalytics(fixture, "fees", "total_fees", { ...fixture.snapshot.result.fees.total_fees, total_fees: 1 });
    assert.equal(figuresOf(fixture, { analytics: fees }).allocation.status, "unverified");
    const inflow = figuresOf(fixture, { analytics: withAnalytics(fixture, "cash_flow", "total_inflow", flow.total_inflow + 1) });
    assert.equal(inflow.sources.status, "unverified");
    assert.equal(inflow.allocation.status, "shown");
  });

  test("U-5: the stored unclassified rows against the import's count, reported, never replacing it", () => {
    const fixture = FIXTURES.F5;
    assert.equal(figuresOf(fixture).review.countsAgree, true);
    const summary = { ...fixture.summary, unclassified_transaction_count: fixture.summary.unclassified_transaction_count + 2 };
    const figures = figuresOf(fixture, { summary });
    assert.equal(figures.review.countsAgree, false);
    assert.equal(figures.review.apiCount, summary.unclassified_transaction_count);
  });
});

describe("stress statement: long names, zero inflow, negative net, nothing unclassified", () => {
  const figures = figuresOf(FIXTURES.stress);

  test("zero inflow is a real KES 0.00 with no sources, and no source share", () => {
    assert.equal(figures.moneyIn.cents, 0);
    assert.deepEqual(figures.sources, { status: "shown", totalCents: 0, items: [] });
  });

  test("the net flow is negative, as the API states it", () => {
    assert.ok(figures.netCents < 0);
    assert.equal(figures.netCents, -figures.moneyOut.cents);
  });

  test("nothing unclassified: zero rows, and the counts agree", () => {
    assert.equal(figures.review.apiCount, 0);
    assert.deepEqual(figures.review.rows, { count: 0, inCents: 0, outCents: 0, scopeId: "unclassified" });
    assert.equal(figures.review.countsAgree, true);
  });

  test("long entity names are kept whole (display truncates, the data doesn't)", () => {
    assert.ok(figures.largest.purchases[0].entity.length > 80);
    assert.equal(figures.largest.derived.find((event) => event.kind === "send").entity, "Wanjiru Akinyi Achieng Nyambura Chepkoech Muthoni Kamau-Odhiambo");
  });
});
