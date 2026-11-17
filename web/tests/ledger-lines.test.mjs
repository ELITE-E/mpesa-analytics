// Ledger lines and CSV (IA migration Stage 5; plan DR-10, rev2 R1.2,
// decisions Q-P3, Q-P4):
//   - a charge linked to a transaction (DR-2) is shown on that transaction's
//     line when both are in the scope; it stays a member of the scope;
//   - otherwise, and for every orphan or ambiguous charge, it is a line of
//     its own carrying its link status (R1.2 disclosure);
//   - the CSV holds one line per member row of the current scope, statement
//     order, without identifier, statement line or channel columns.
// Rows are fixture F1 (rev1 §1.5): fees 8, 10, 12 linked to 7, 9, 11; fee 16
// orphan; fee 20 ambiguous between 18 and 19.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/ledger-lines.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { linkCharges } = await import("../src/lib/statement/charges.ts");
const { resolveLedgerScope } = await import("../src/lib/statement/scopes.ts");
const { ledgerLines } = await import("../src/lib/statement/ledger-lines.ts");
const { LEDGER_CSV_HEADER, ledgerCsvRows } = await import("../src/lib/ledger-csv.ts");
const { csvText } = await import("../src/lib/download-csv.ts");

const F1 = contractFixtures()["F1-worked-example"];
const rows = F1.rows.map(toStatementRow);
const links = linkCharges(rows);
const membersOf = (scopeId) => {
  const ids = new Set(resolveLedgerScope(scopeId, rows).rowIds);
  return rows.filter((row) => ids.has(row.id));
};
const summary = (lines) => lines.map((line) => ({ id: line.row.id, charges: line.foldedCharges.map((c) => c.id), link: line.ownLink?.status ?? null }));

describe("Ledger lines", () => {
  test("every row: linked charges sit on their transaction; unlinked charges stand alone", () => {
    const lines = ledgerLines(rows, links);
    assert.equal(lines.length, 17);
    assert.deepEqual(summary(lines).filter((line) => line.charges.length || line.link), [
      { id: 7, charges: [8], link: null },
      { id: 9, charges: [10], link: null },
      { id: 11, charges: [12], link: null },
      { id: 16, charges: [], link: "orphan" },
      { id: 20, charges: [], link: "ambiguous" },
    ]);
    assert.deepEqual(lines.find((line) => line.row.id === 20).ownLink.candidateIds, [18, 19]);
  });

  test("folded charges stay members: lines plus folded charges are exactly the rows", () => {
    const lines = ledgerLines(rows, links);
    const shown = lines.flatMap((line) => [line.row.id, ...line.foldedCharges.map((c) => c.id)]).sort((a, b) => a - b);
    assert.deepEqual(shown, rows.map((row) => row.id));
  });

  test("the fees scope: no transaction is in it, so each charge is its own line with its link", () => {
    const lines = ledgerLines(membersOf("fees"), links);
    assert.deepEqual(summary(lines), [
      { id: 8, charges: [], link: "linked" },
      { id: 10, charges: [], link: "linked" },
      { id: 12, charges: [], link: "linked" },
      { id: 16, charges: [], link: "orphan" },
      { id: 20, charges: [], link: "ambiguous" },
    ]);
  });

  test("a receipt scope: the payment with its charge on one line", () => {
    assert.deepEqual(summary(ledgerLines(membersOf("receipt:SYNWEB000"), links)), [{ id: 7, charges: [8], link: null }]);
  });

  test("an empty scope has no lines", () => {
    assert.deepEqual(ledgerLines([], links), []);
  });
});

describe("Ledger CSV", () => {
  test("header: no identifier, statement line or channel", () => {
    assert.deepEqual(LEDGER_CSV_HEADER, [
      "receipt_no",
      "date",
      "time",
      "entity",
      "counts_as",
      "event_type",
      "money_in_kes",
      "money_out_kes",
      "balance_kes",
      "statement_details",
    ]);
  });

  test("one line per member row of the scope, charges included, nothing else", () => {
    assert.deepEqual(ledgerCsvRows(membersOf("receipt:SYNWEB000")), [
      ["SYNWEB000", "2026-07-01", "08:06:00", "Utility", "Spending", "BILL_PAYMENT", "", "2000.00", "13830.00", "Pay Bill to Synthetic Utility"],
      ["SYNWEB000", "2026-07-01", "08:07:00", "NO_ENTITY_IDENTIFIED", "Charges", "FEE", "", "30.00", "13800.00", "Pay Bill Charge"],
    ]);
  });

  test("money columns add up to the scope's own totals", () => {
    const csv = ledgerCsvRows(rows);
    const sum = (column) => csv.reduce((total, line) => total + Math.round(Number(line[column] || 0) * 100), 0);
    assert.equal(csv.length, rows.length);
    assert.equal(sum(6), Math.round(F1.snapshot.result.cash_flow.total_inflow * 100));
    assert.equal(sum(7), Math.round(F1.snapshot.result.cash_flow.total_outflow * 100));
  });

  test("an invalid time keeps its raw text in the date column", () => {
    const f3 = contractFixtures()["F3-invalid-timestamps"].rows.map(toStatementRow);
    const invalid = ledgerCsvRows(f3).find((line) => line[0] === f3.find((row) => row.completedAt === null).receiptNo);
    assert.equal(invalid[2], "");
    assert.equal(invalid[1], f3.find((row) => row.completedAt === null).source.completion_time);
  });

  test("an empty scope exports only the header", () => {
    assert.equal(csvText(LEDGER_CSV_HEADER, ledgerCsvRows([])), LEDGER_CSV_HEADER.map((cell) => `"${cell}"`).join(","));
  });

  test("commas, quotes and newlines are escaped", () => {
    assert.equal(csvText(["a"], [['He said "1,000"\nthen left']]), '"a"\n"He said ""1,000""\nthen left"');
  });
});
