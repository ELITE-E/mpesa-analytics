// Cash area figures (IA migration Stage 7e): where every figure on the Cash
// page comes from, and that every door's Ledger scope adds up to the figure
// it opens (DR-10, I-4).
//   Cash withdrawn is the Cash-withdrawn bucket (DR-3: WITHDRAWAL rows going
//   out, principal); the API has no withdrawal total, so, as for Spending,
//   the derived figures are withheld when the rows' outflow or charges
//   disagree with the API's (U-2, U-3: T-UNVERIFIED). Agents are the bucket's
//   rows by exact stored entity (DR-8); a cash deposit at the same agent is
//   Money In, never Cash. Charges linked to withdrawals are display only
//   (Q-LINK), counted in Fees; their DR-7 share of the cash withdrawn.
// Oracles come from the fixtures' rows and API fields, not from the app.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/cash-figures.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { cashEdgeCasesFixture, prototypeSampleWithBackendAnalytics } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { resolveLedgerScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");
const { share } = await import("../src/lib/statement/totals.ts");
const { cashFigures } = await import("../src/lib/statement/cash.ts");

const CONTRACT = contractFixtures();
const FIXTURES = {
  F1: CONTRACT["F1-worked-example"],
  F5: prototypeSampleWithBackendAnalytics(),
  edge: cashEdgeCasesFixture(),
};
const EMPTY = CONTRACT["F4-paginated-2345"];
const cents = (amount) => Math.round(amount * 100);
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
const withdrawals = (fixture) => fixture.rows.filter((row) => row.event_type === "WITHDRAWAL" && row.cash_flow_direction === "OUTFLOW");

/** The charges linked to `parents`: FEE rows whose receipt has exactly one non-fee row, one of `parents`, by parent id. */
function linkedCharges(fixture, parents) {
  const byParent = new Map();
  for (const fee of fixture.rows.filter((row) => row.event_type === "FEE")) {
    const onReceipt = fixture.rows.filter((row) => row.receipt_no === fee.receipt_no && row.event_type !== "FEE");
    if (onReceipt.length === 1 && parents.includes(onReceipt[0])) byParent.set(onReceipt[0].id, (byParent.get(onReceipt[0].id) ?? 0) + cents(fee.paid_out));
  }
  return byParent;
}

/** The figures of `fixture`, with its rows loaded unless `rows` says otherwise. */
function figuresOf(fixture, { rows = fixture.rows, analytics = fixture.snapshot.result } = {}) {
  return cashFigures({ summary: fixture.summary, analytics, rows: rows === null ? null : rows.map(toStatementRow) });
}

/** The DR-10 figure of Ledger scope `id` over `fixture`'s rows. */
function scopeFigure(fixture, id) {
  const rows = fixture.rows.map(toStatementRow);
  const scope = resolveLedgerScope(id, rows);
  assert.ok(scope, `scope ${id} resolves`);
  return scopeFigureCents(rows, scope);
}

describe("cash withdrawn (the Cash-withdrawn bucket)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the withdrawals' principal, its door adding up to it; the linked charges and their share`, () => {
      const { breakdown } = cashFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) });
      assert.equal(breakdown.status, "shown");
      const members = withdrawals(fixture);
      assert.deepEqual({ cents: breakdown.total.cents, count: breakdown.total.count }, { cents: sum(members, "paid_out"), count: members.length });
      assert.equal(breakdown.total.scopeId, "bucket:cash-withdrawn");
      assert.equal(scopeFigure(fixture, breakdown.total.scopeId), breakdown.total.cents);
      const linked = linkedCharges(fixture, members);
      const chargeCents = [...linked.values()].reduce((total, value) => total + value, 0);
      assert.deepEqual(breakdown.charges, { cents: chargeCents, count: linked.size, share: share(chargeCents, breakdown.total.cents) });
    });
  }

  test("edge: four withdrawals at two identified agents; charges KES 163.00, 1.3% of the cash", () => {
    const { breakdown } = figuresOf(FIXTURES.edge);
    assert.deepEqual(breakdown.total, { cents: 1300000, count: 4, agents: 2, scopeId: "bucket:cash-withdrawn" });
    assert.deepEqual(breakdown.charges, { cents: 16300, count: 3, share: 1.3 });
  });
});

describe("agents (DR-8)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: each agent's withdrawals, largest first, each a door to its withdrawals that adds up`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = new Map();
      for (const row of withdrawals(fixture)) {
        const agent = expected.get(row.entity) ?? { cents: 0, count: 0 };
        agent.cents += cents(row.paid_out);
        agent.count += 1;
        expected.set(row.entity, agent);
      }
      assert.deepEqual(new Map(breakdown.agents.map((agent) => [agent.entity, { cents: agent.cents, count: agent.count }])), expected);
      const amounts = breakdown.agents.map((agent) => agent.cents);
      assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a), "largest first");
      for (const agent of breakdown.agents) {
        assert.equal(agent.scopeId, `group:cash-withdrawn:${agent.entity}`);
        assert.equal(scopeFigure(fixture, agent.scopeId), agent.cents, agent.scopeId);
        assert.equal(agent.share, share(agent.cents, breakdown.total.cents));
      }
    });
  }

  test("edge: an agent's cash deposit stays out of its door; an unidentified agent is 'Not identified' and isn't counted as an agent", () => {
    const fixture = FIXTURES.edge;
    const { breakdown } = figuresOf(fixture);
    const juja = breakdown.agents.find((agent) => agent.entity === "Juja Rd Agencies");
    assert.equal(juja.cents, 1000000, "the KES 3,000.00 deposit is Money In");
    assert.equal(scopeFigure(fixture, juja.scopeId), 1000000);
    assert.equal(breakdown.agents.find((agent) => agent.entity === "NO_ENTITY_IDENTIFIED").label, "Not identified");
  });
});

describe("largest withdrawals", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: by principal (ties keep statement order), each opening its receipt, which adds up to principal + charge`, () => {
      const { breakdown } = figuresOf(fixture);
      const expected = withdrawals(fixture)
        .map((row, position) => ({ row, position }))
        .sort((a, b) => cents(b.row.paid_out) - cents(a.row.paid_out) || a.position - b.position)
        .slice(0, 5)
        .map(({ row }) => [row.receipt_no, cents(row.paid_out)]);
      assert.deepEqual(breakdown.withdrawals.map((item) => [item.receiptNo, item.cents]), expected);
      for (const item of breakdown.withdrawals) {
        assert.equal(item.scopeId, `receipt:${item.receiptNo}`);
        assert.equal(scopeFigure(fixture, item.scopeId), item.cents + item.chargeCents, item.receiptNo);
      }
    });
  }
});

describe("treatments (Q-D9) and empty data", () => {
  test("T-LOADFAIL: without rows there is no Cash figure", () => {
    assert.equal(figuresOf(FIXTURES.F5, { rows: null }).breakdown, null);
  });

  test("T-UNVERIFIED: the rows' outflow or charges disagreeing with the API's withholds every derived figure", () => {
    for (const mutate of [(analytics) => (analytics.cash_flow.total_outflow += 1), (analytics) => (analytics.fees.total_fees.total_fees += 1)]) {
      const analytics = structuredClone(FIXTURES.edge.snapshot.result);
      mutate(analytics);
      assert.deepEqual(figuresOf(FIXTURES.edge, { analytics }).breakdown, { status: "unverified" });
    }
  });

  test("no withdrawals (F4): a real zero, no agents, no withdrawals, no charges", () => {
    const { breakdown } = figuresOf(EMPTY);
    assert.equal(breakdown.status, "shown");
    assert.deepEqual(breakdown.total, { cents: 0, count: 0, agents: 0, scopeId: "bucket:cash-withdrawn" });
    assert.deepEqual(breakdown.charges, { cents: 0, count: 0, share: null });
    assert.deepEqual([breakdown.agents, breakdown.withdrawals], [[], []]);
  });
});
