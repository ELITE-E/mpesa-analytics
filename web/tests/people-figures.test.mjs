// People area figures (IA migration Stage 7b): where every figure on the
// People page comes from, and that every door's Ledger scope adds up to the
// figure it opens (DR-10, I-4).
//   M-15: sent and received are the API's `transfers.total_transfers` and
//     `total_received` (principal, charges excluded); with rows they must
//     equal the Sent-to-people and From-people buckets, or the derived
//     figures are withheld (T-UNVERIFIED). Per person, both directions, from
//     the rows (DR-8): identity is the exact stored `entity` (M-16: no phone
//     number in the API), so two spellings stay two people and an
//     unidentified recipient is "Not identified". Counts per recipient agree
//     with the API's `by_recipient_count`; the largest sends with its
//     `largest_transfers`.
//   Charges linked to sends are display only (Q-LINK), counted in Fees.
// Oracles come from the fixtures' API fields, not from the app.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/people-figures.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { peopleEdgeCasesFixture, prototypeSampleWithBackendAnalytics } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { resolveLedgerScope, scopeFigureCents } = await import("../src/lib/statement/scopes.ts");
const { peopleFigures } = await import("../src/lib/statement/people.ts");

const CONTRACT = contractFixtures();
const FIXTURES = {
  F1: CONTRACT["F1-worked-example"],
  F5: prototypeSampleWithBackendAnalytics(),
  edge: peopleEdgeCasesFixture(),
};
const EMPTY = CONTRACT["F4-paginated-2345"];
const cents = (amount) => Math.round(amount * 100);
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
const sends = (fixture) => fixture.rows.filter((row) => row.event_type === "TRANSFER_OUT" && row.cash_flow_direction === "OUTFLOW");
const receipts = (fixture) => fixture.rows.filter((row) => row.event_type === "TRANSFER_IN" && row.cash_flow_direction === "INFLOW");

/** The figures of `fixture`, with its rows loaded unless `rows` says otherwise. */
function figuresOf(fixture, { rows = fixture.rows, analytics = fixture.snapshot.result } = {}) {
  return peopleFigures({ summary: fixture.summary, analytics, rows: rows === null ? null : rows.map(toStatementRow) });
}

/** The DR-10 figure of Ledger scope `id` over `fixture`'s rows. */
function scopeFigure(fixture, id) {
  const rows = fixture.rows.map(toStatementRow);
  const scope = resolveLedgerScope(id, rows);
  assert.ok(scope, `scope ${id} resolves`);
  return scopeFigureCents(rows, scope);
}

/** The rows of `members` grouped by exact entity, in first-appearance order: { entity: { cents, count } }. */
function byEntity(members, field) {
  const groups = new Map();
  for (const row of members) {
    const group = groups.get(row.entity) ?? { cents: 0, count: 0 };
    group.cents += cents(row[field]);
    group.count += 1;
    groups.set(row.entity, group);
  }
  return groups;
}

describe("sent and received (M-15)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the API's totals, equal to the rows' buckets, each door adding up to its figure`, () => {
      const figures = figuresOf(fixture);
      const api = fixture.snapshot.result.transfers;
      assert.equal(figures.api.sentCents, cents(api.total_transfers.total_transfer_amount));
      assert.equal(figures.api.receivedCents, cents(api.total_received.total_received));
      const { breakdown } = figures;
      assert.equal(breakdown.status, "shown");
      assert.deepEqual(
        { sent: breakdown.sent.cents, sends: breakdown.sent.count, received: breakdown.received.cents, receipts: breakdown.received.count },
        { sent: sum(sends(fixture), "paid_out"), sends: sends(fixture).length, received: sum(receipts(fixture), "paid_in"), receipts: receipts(fixture).length },
      );
      assert.equal(breakdown.sent.cents, figures.api.sentCents);
      assert.equal(breakdown.received.cents, figures.api.receivedCents);
      assert.equal(breakdown.sent.scopeId, "bucket:sent-to-people");
      assert.equal(breakdown.received.scopeId, "bucket:from-people");
      assert.equal(scopeFigure(fixture, breakdown.sent.scopeId), breakdown.sent.cents);
      assert.equal(scopeFigure(fixture, breakdown.received.scopeId), breakdown.received.cents);
      assert.equal(breakdown.netCents, breakdown.received.cents - breakdown.sent.cents);
    });
  }
});

describe("each person, both directions (DR-8; identity = exact stored entity, M-16)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: every name in either direction, its sent and received each a door to that person's rows in that direction`, () => {
      const { breakdown } = figuresOf(fixture);
      const sent = byEntity(sends(fixture), "paid_out");
      const received = byEntity(receipts(fixture), "paid_in");
      const names = new Set([...sent.keys(), ...received.keys()]);
      assert.deepEqual(new Set(breakdown.people.map((person) => person.entity)), names);
      for (const person of breakdown.people) {
        assert.deepEqual(person.sent && { cents: person.sent.cents, count: person.sent.count }, sent.get(person.entity) ?? null, person.entity);
        assert.deepEqual(person.received && { cents: person.received.cents, count: person.received.count }, received.get(person.entity) ?? null, person.entity);
        if (person.sent) {
          assert.equal(person.sent.scopeId, `group:sent-to-people:${person.entity}`);
          assert.equal(scopeFigure(fixture, person.sent.scopeId), person.sent.cents, person.sent.scopeId);
        }
        if (person.received) {
          assert.equal(person.received.scopeId, `group:from-people:${person.entity}`);
          assert.equal(scopeFigure(fixture, person.received.scopeId), person.received.cents, person.received.scopeId);
        }
      }
      const moved = breakdown.people.map((person) => (person.sent?.cents ?? 0) + (person.received?.cents ?? 0));
      assert.deepEqual(moved, [...moved].sort((a, b) => b - a), "largest total moved first");
    });

    test(`${name}: send counts per recipient agree with the API's by_recipient_count`, () => {
      const { breakdown } = figuresOf(fixture);
      const api = fixture.snapshot.result.transfers.by_recipient_count;
      for (const item of api) {
        const person = breakdown.people.find((candidate) => candidate.entity === item.recipient);
        assert.equal(person?.sent?.count, item.transaction_count, item.recipient);
      }
    });
  }

  test("edge cases: two spellings stay two people; an unidentified recipient is 'Not identified' and its door excludes charge rows; a merchant of the same name isn't a person's row", () => {
    const fixture = FIXTURES.edge;
    const { breakdown } = figuresOf(fixture);
    const entities = breakdown.people.map((person) => person.entity);
    assert.ok(entities.includes("Mary Wanjiku") && entities.includes("MARY WANJIKU"));
    const unidentified = breakdown.people.find((person) => person.entity === "NO_ENTITY_IDENTIFIED");
    assert.equal(unidentified.label, "Not identified");
    assert.equal(scopeFigure(fixture, unidentified.sent.scopeId), 70000);
    const mary = breakdown.people.find((person) => person.entity === "Mary Wanjiku");
    assert.equal(mary.sent.cents, 200000, "the merchant payment of the same name is Spending, not a send");
    assert.equal(breakdown.sent.people, 3, "three identified recipients; the unidentified send isn't counted as a person");
    assert.equal(breakdown.received.people, 2);
  });
});

describe("largest sends and what sending cost", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`${name}: the three largest sends by principal, as the API ranks them, each opening its receipt (principal + linked charge)`, () => {
      const { breakdown } = figuresOf(fixture);
      const api = fixture.snapshot.result.transfers.largest_transfers.slice(0, 3);
      if (fixture !== FIXTURES.F1) {
        assert.deepEqual(breakdown.largestSends.map((send) => [send.entity, send.cents]), api.map((item) => [item.recipient, cents(item.amount)]));
      }
      for (const send of breakdown.largestSends) {
        assert.equal(send.scopeId, `receipt:${send.receiptNo}`);
        const onReceipt = fixture.rows.filter((row) => row.receipt_no === send.receiptNo);
        const sole = onReceipt.filter((row) => row.event_type !== "FEE").length === 1;
        if (sole) {
          assert.equal(send.chargeCents, sum(onReceipt.filter((row) => row.event_type === "FEE"), "paid_out"));
          assert.equal(scopeFigure(fixture, send.scopeId), send.cents + send.chargeCents, send.receiptNo);
        }
      }
    });

    test(`${name}: charges linked to sends, display only (Q-LINK)`, () => {
      const { breakdown } = figuresOf(fixture);
      const linked = fixture.rows.filter((fee) => {
        if (fee.event_type !== "FEE") return false;
        const parents = fixture.rows.filter((row) => row.receipt_no === fee.receipt_no && row.event_type !== "FEE");
        return parents.length === 1 && sends(fixture).includes(parents[0]);
      });
      assert.deepEqual(breakdown.sendCharges, { cents: sum(linked, "paid_out"), count: new Set(linked.map((fee) => fee.receipt_no)).size });
    });
  }
});

describe("treatments (Q-D9) and empty data", () => {
  test("T-LOADFAIL: without rows only the API's totals remain", () => {
    const figures = figuresOf(FIXTURES.F5, { rows: null });
    assert.equal(figures.breakdown, null);
    assert.equal(figures.api.sentCents, cents(FIXTURES.F5.snapshot.result.transfers.total_transfers.total_transfer_amount));
  });

  test("T-UNVERIFIED: the API's sent or received disagreeing with the rows withholds every derived figure", () => {
    const fixture = FIXTURES.F5;
    for (const field of ["total_transfers", "total_received"]) {
      const analytics = structuredClone(fixture.snapshot.result);
      const key = field === "total_transfers" ? "total_transfer_amount" : "total_received";
      analytics.transfers[field][key] += 1;
      assert.deepEqual(figuresOf(fixture, { analytics }).breakdown, { status: "unverified" }, field);
    }
  });

  test("no transfers (F4): a real zero both ways, no people, no sends", () => {
    const { breakdown, api } = figuresOf(EMPTY);
    assert.deepEqual(api, { sentCents: 0, receivedCents: 0 });
    assert.equal(breakdown.status, "shown");
    assert.equal(breakdown.sent.cents, 0);
    assert.equal(breakdown.received.cents, 0);
    assert.deepEqual(breakdown.people, []);
    assert.deepEqual(breakdown.largestSends, []);
  });
});
