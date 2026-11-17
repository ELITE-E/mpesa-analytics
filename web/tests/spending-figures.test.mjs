// Spending area figures (IA migration Stage 7a): where every figure on the
// Spending page comes from, and that every door's Ledger scope adds up to
// the figure it opens (DR-10, I-4).
//   Q-D1: the headline is principal, the Spending bucket (DR-3/DR-5); the
//     charges linked to those payments are a secondary, display-only figure
//     (Q-LINK); merchants are ranked by principal (DR-8); no API total-cost
//     figure appears.
//   Q-D2: airtime is its own bucket, listed under "not counted", never in
//     the headline.
//   DR-7 shares, DR-9 daily average, channels by event type (M-11), the
//   most recent receipts (M-14), the API's recurring lists (M-13).
//   Treatments (Q-D9): without rows only the API's recurring lists remain
//   (T-LOADFAIL); U-2 or U-3 disagreeing withholds the derived figures
//   (T-UNVERIFIED) and keeps the receipts, which are rows as stored.
// Oracles come from the fixtures' API fields, not from the app.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/spending-figures.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { noSpendingFixture, prototypeSampleWithBackendAnalytics, stressOverviewFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { resolveLedgerScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");
const { dailyAverageCents, outflowAllocation, share } = await import("../src/lib/statement/totals.ts");
const { spendingFigures } = await import("../src/lib/statement/spending.ts");

const FIXTURES = {
  F1: contractFixtures()["F1-worked-example"],
  F5: prototypeSampleWithBackendAnalytics(),
  stress: stressOverviewFixture(),
  none: noSpendingFixture(),
};
const SPENDING_TYPES = { MERCHANT_PAYMENT: "till", BILL_PAYMENT: "paybill", BUNDLE_PURCHASE: "bundle" };
const cents = (amount) => Math.round(amount * 100);
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);

/** The spending rows of `fixture` by its API fields: outflows of the backend's spending event types. */
function spendingRows(fixture) {
  return fixture.rows.filter((row) => row.cash_flow_direction === "OUTFLOW" && row.event_type in SPENDING_TYPES);
}

/** The figures of `fixture`, with its rows loaded unless `rows` says otherwise. */
function figuresOf(fixture, { rows = fixture.rows, analytics = fixture.snapshot.result } = {}) {
  return spendingFigures({ summary: fixture.summary, analytics, rows: rows === null ? null : rows.map(toStatementRow) });
}

/** The DR-10 figure of Ledger scope `id` over `fixture`'s rows. */
function scopeFigure(fixture, id) {
  const rows = fixture.rows.map(toStatementRow);
  const scope = resolveLedgerScope(id, rows);
  assert.ok(scope, `scope ${id} resolves`);
  return scopeFigureCents(rows, scope);
}

describe("headline: principal (Q-D1), airtime apart (Q-D2)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the Spending bucket's principal and count, its scope adds up to it, and it is the allocation's Spending`, () => {
      const { breakdown } = figuresOf(fixture);
      const rows = spendingRows(fixture);
      assert.equal(breakdown.status, "shown");
      assert.equal(breakdown.totalCents, sum(rows, "paid_out"));
      assert.equal(breakdown.count, rows.length);
      assert.equal(breakdown.scopeId, "bucket:spending");
      assert.equal(scopeFigure(fixture, breakdown.scopeId), breakdown.totalCents);
      const allocated = outflowAllocation(fixture.rows.map(toStatementRow)).find((bucket) => bucket.bucket === "spending");
      assert.equal(breakdown.totalCents, allocated?.cents ?? 0);
    });

    test(`${name}: DR-9 daily average and DR-7 share of money out`, () => {
      const { breakdown } = figuresOf(fixture);
      const { period_start: start, period_end: end } = fixture.summary;
      const out = sum(fixture.rows.filter((row) => row.cash_flow_direction === "OUTFLOW"), "paid_out");
      assert.equal(breakdown.dailyAverageCents, dailyAverageCents(breakdown.totalCents, start, end));
      assert.equal(breakdown.moneyOutCents, out);
      assert.equal(breakdown.shareOfOut, share(breakdown.totalCents, out));
    });

    test(`${name}: charges linked to these payments, display only (Q-LINK)`, () => {
      const { breakdown } = figuresOf(fixture);
      const linked = fixture.rows.filter((fee) => {
        if (fee.event_type !== "FEE") return false;
        const parents = fixture.rows.filter((row) => row.receipt_no === fee.receipt_no && row.event_type !== "FEE");
        return parents.length === 1 && spendingRows(fixture).includes(parents[0]);
      });
      assert.equal(breakdown.linkedChargeCents, sum(linked, "paid_out"));
    });
  }

  test("Q-D2: airtime is not in the headline and is listed as not counted, with its own scope", () => {
    for (const fixture of [FIXTURES.F1, FIXTURES.F5, FIXTURES.none]) {
      const { breakdown } = figuresOf(fixture);
      const airtime = fixture.rows.filter((row) => row.event_type === "AIRTIME_PURCHASE" && row.cash_flow_direction === "OUTFLOW");
      assert.ok(airtime.length > 0);
      const item = breakdown.notCounted.items.find((entry) => entry.bucket === "airtime");
      assert.equal(item.cents, sum(airtime, "paid_out"));
      assert.equal(scopeFigure(fixture, item.scopeId), item.cents);
    }
  });
});

describe("every door's Ledger scope adds up to its figure (DR-10, I-4)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: channels by event type (M-11) add up to the headline, each with its DR-7 share and scope`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = Object.entries(SPENDING_TYPES)
        .map(([type, channel]) => {
          const rows = spendingRows(fixture).filter((row) => row.event_type === type);
          return { channel, cents: sum(rows, "paid_out"), count: rows.length };
        })
        .filter((channel) => channel.count > 0);
      assert.deepEqual(breakdown.channels.map(({ channel, cents: amount, count }) => ({ channel, cents: amount, count })), expected);
      for (const channel of breakdown.channels) {
        assert.equal(channel.scopeId, `spending:${channel.channel}`);
        assert.equal(scopeFigure(fixture, channel.scopeId), channel.cents);
        assert.equal(channel.share, share(channel.cents, breakdown.totalCents));
      }
    });

    test(`${name}: "not counted" is every other outflow bucket, each reconciling, and with Spending makes money out (I-1)`, () => {
      const { breakdown } = figuresOf(fixture);
      const others = outflowAllocation(fixture.rows.map(toStatementRow)).filter((bucket) => bucket.bucket !== "spending");
      assert.deepEqual(breakdown.notCounted.items.map(({ bucket, cents: amount }) => ({ bucket, cents: amount })), others.map(({ bucket, cents: amount }) => ({ bucket, cents: amount })));
      for (const item of breakdown.notCounted.items) assert.equal(scopeFigure(fixture, item.scopeId), item.cents, item.scopeId);
      assert.equal(breakdown.notCounted.totalCents + breakdown.totalCents, breakdown.moneyOutCents);
    });

    test(`${name}: merchants ranked by principal (DR-8), top 5, each group's scope adding up to it`, () => {
      const { breakdown } = figuresOf(fixture);
      const byEntity = new Map();
      for (const row of spendingRows(fixture)) byEntity.set(row.entity, [...(byEntity.get(row.entity) ?? []), row]);
      const ranked = [...byEntity.entries()].map(([entity, rows]) => ({ entity, cents: sum(rows, "paid_out"), count: rows.length })).sort((a, b) => b.cents - a.cents);
      assert.equal(breakdown.merchants.groupCount, ranked.length);
      assert.deepEqual(breakdown.merchants.items.map(({ entity, cents: amount, count }) => ({ entity, cents: amount, count })), ranked.slice(0, 5));
      breakdown.merchants.items.forEach((merchant, index) => {
        assert.equal(merchant.rank, index + 1);
        assert.equal(merchant.scopeId, `group:spending:${merchant.entity}`);
        assert.equal(scopeFigure(fixture, merchant.scopeId), merchant.cents);
        assert.equal(merchant.share, share(merchant.cents, breakdown.totalCents));
        assert.equal(merchant.barShare, share(merchant.cents, breakdown.merchants.items[0].cents));
      });
    });

    test(`${name}: receipt previews are the most recent spending rows, all and per top merchant, each opening its receipt`, () => {
      const { receipts, breakdown } = figuresOf(fixture);
      const rows = spendingRows(fixture);
      const recent = (members) => members.slice(-3).reverse().map((row) => row.receipt_no);
      assert.deepEqual(receipts.filters[0], { id: "all", label: null, count: rows.length });
      assert.deepEqual(receipts.previews.all.map((receipt) => receipt.receiptNo), recent(rows));
      for (const filter of receipts.filters.slice(1)) {
        const members = rows.filter((row) => row.entity === filter.id);
        assert.equal(filter.count, members.length);
        assert.deepEqual(receipts.previews[filter.id].map((receipt) => receipt.receiptNo), recent(members));
      }
      assert.deepEqual(receipts.filters.slice(1).map((filter) => filter.id), breakdown.merchants.items.slice(0, 3).map((merchant) => merchant.entity));
      for (const receipt of receipts.previews.all) {
        const row = fixture.rows.find((candidate) => candidate.receipt_no === receipt.receiptNo && candidate.event_type in SPENDING_TYPES);
        assert.equal(receipt.cents, cents(row.paid_out));
        assert.equal(receipt.balanceCents, cents(row.balance));
        assert.equal(receipt.scopeId, `receipt:${row.receipt_no}`);
      }
    });
  }
});

describe("recurring payments: the API's lists (M-13)", () => {
  test("recurring purchases and bills as the API lists them, each opening its merchant's spending rows", () => {
    for (const fixture of [FIXTURES.F5, FIXTURES.stress]) {
      const api = fixture.snapshot.result;
      const expected = [
        ...api.spending.recurring_purchases.map((item) => ({ kind: "purchase", name: item.merchant, occurrences: item.occurrences, dates: item.dates })),
        ...api.bills.recurring_bills.map((item) => ({ kind: "bill", name: item.bill, occurrences: item.occurrences, dates: item.dates })),
      ];
      const { recurring } = figuresOf(fixture);
      assert.deepEqual(recurring.map(({ kind, name, occurrences, dates }) => ({ kind, name, occurrences, dates })), expected);
      for (const item of recurring) assert.equal(item.scopeId, `group:spending:${item.name}`);
    }
  });
});

describe("treatments (Q-D9) and empty data", () => {
  test("T-LOADFAIL: without rows only the API's recurring lists remain", () => {
    const figures = figuresOf(FIXTURES.F5, { rows: null });
    assert.equal(figures.breakdown, null);
    assert.equal(figures.receipts, null);
    assert.ok(Array.isArray(figures.recurring));
  });

  test("T-UNVERIFIED: U-2 or U-3 disagreeing withholds the derived figures; the receipts stay", () => {
    const fixture = FIXTURES.F5;
    for (const [section, field, value] of [
      ["cash_flow", "total_outflow", fixture.snapshot.result.cash_flow.total_outflow + 1],
      ["fees", "total_fees", { ...fixture.snapshot.result.fees.total_fees, total_fees: 1 }],
    ]) {
      const analytics = structuredClone(fixture.snapshot.result);
      analytics[section][field] = value;
      const figures = figuresOf(fixture, { analytics });
      assert.deepEqual(figures.breakdown, { status: "unverified" }, field);
      assert.equal(figures.receipts.previews.all.length, 3, field);
    }
  });

  test("no spending: a real zero with no channels, merchants or receipts; money out still accounted for", () => {
    const { breakdown, receipts } = figuresOf(FIXTURES.none);
    assert.equal(breakdown.totalCents, 0);
    assert.equal(breakdown.count, 0);
    assert.deepEqual(breakdown.channels, []);
    assert.deepEqual(breakdown.merchants.items, []);
    assert.deepEqual(receipts.previews.all, []);
    assert.equal(breakdown.shareOfOut, 0);
    assert.equal(breakdown.notCounted.totalCents, breakdown.moneyOutCents);
  });
});
