// Statement domain, opening balance (IA migration Stage 4b; plan rev1 DR-4,
// I-9; rev2 U-4):
//   O1 = closing_balance − (total_inflow − total_outflow), API values only;
//   O2 = earliest row's balance − paid_in + paid_out, only when exactly one
//        row holds the earliest valid time and no row's time is invalid;
//   O2 ≠ O1 (to the cent) is a mismatch. An empty import has no opening
//   balance (the backend reports closing_balance 0.0 for it, a placeholder).
// "Unavailable" (missing information) and "mismatch" are distinct outcomes.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-balances.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { openingBalance } = await import("../src/lib/statement/balances.ts");

const FIXTURES = contractFixtures();

/** The opening balance of fixture `name`, optionally with its API rows changed first. */
function openingOf(name, changeRows = (rows) => rows) {
  const fixture = FIXTURES[name];
  const rows = changeRows(structuredClone(fixture.rows)).map(toStatementRow);
  return openingBalance(rows, fixture.snapshot.result.cash_flow);
}

describe("DR-4 opening balance", () => {
  test("O1 and O2 agree when the statement ties (F1: 500.00, rev1 §1.5)", () => {
    assert.deepEqual(openingOf("F1-worked-example"), {
      o1Cents: 50000,
      o2: { status: "computed", cents: 50000 },
      check: "agrees",
    });
  });

  test("O1 holds the net identity with the API totals (I-9)", () => {
    const { cash_flow } = FIXTURES["F1-worked-example"].snapshot.result;
    const { o1Cents } = openingOf("F1-worked-example");
    assert.equal(Math.round(cash_flow.closing_balance * 100) - o1Cents, Math.round(cash_flow.net_cash_flow * 100));
  });

  test("O2 is unavailable, not guessed, when two rows share the earliest time (F2)", () => {
    assert.deepEqual(openingOf("F2-tied-timestamps"), {
      o1Cents: 10000,
      o2: { status: "unavailable", reason: "tied-earliest-time" },
      check: "not-checked",
    });
  });

  test("O2 is unavailable when any row's time is invalid (F3)", () => {
    assert.deepEqual(openingOf("F3-invalid-timestamps").o2, { status: "unavailable", reason: "invalid-time" });
    assert.equal(openingOf("F3-invalid-timestamps").check, "not-checked");
  });

  test("a stated balance that doesn't continue to the totals is a mismatch, not a missing value", () => {
    // F1 with its first balance off by KES 1.00 (a continuity break, plan A-04).
    const broken = openingOf("F1-worked-example", (rows) => {
      rows[0].balance += 1;
      return rows;
    });
    assert.deepEqual(broken, { o1Cents: 50000, o2: { status: "computed", cents: 50100 }, check: "mismatch" });
  });

  test("an empty import has no opening balance at all", () => {
    const placeholder = { total_inflow: 0, total_outflow: 0, net_cash_flow: 0, closing_balance: 0 };
    assert.deepEqual(openingBalance([], placeholder), {
      o1Cents: null,
      o2: { status: "unavailable", reason: "no-rows" },
      check: "not-checked",
    });
  });
});
