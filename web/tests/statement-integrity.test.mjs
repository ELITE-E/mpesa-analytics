// Statement domain, hard integrity checks (IA migration Stage 4b; plan rev2
// R2.1 DR-0): H-1..H-3 are enforced by getAllTransactions (H2 fix); this
// covers the rest, enforced the same way (user decision, Stage 4b):
//   H-4 the rows loaded = summary.transaction_count;
//   H-5 every row has finite amounts and never both paid_in > 0 and
//       paid_out > 0.
// A failure rejects like H2: ApiError(0, "incomplete_transactions"), so the
// screen shows its error card with Try again (T-LOADFAIL), never partial rows.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-integrity.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { assertRowsIntact } = await import("../src/lib/statement/integrity.ts");

const FIXTURES = contractFixtures();
const F1 = FIXTURES["F1-worked-example"];

/** Whether `error` is the load-failure error H-1..H-3 already use. */
const isIncompleteTransactions = (error) => error.status === 0 && error.code === "incomplete_transactions";

describe("DR-0 hard checks H-4 and H-5", () => {
  test("accept an intact import (F1, F4, F5)", () => {
    for (const name of ["F1-worked-example", "F4-paginated-2345", "F5-prototype-converted"]) {
      assert.doesNotThrow(() => assertRowsIntact(FIXTURES[name].rows, FIXTURES[name].summary), name);
    }
  });

  test("H-4 rejects rows that don't match the summary's transaction_count", () => {
    assert.throws(() => assertRowsIntact(F1.rows.slice(1), F1.summary), isIncompleteTransactions);
  });

  test("H-5 rejects a row with money both in and out", () => {
    const rows = structuredClone(F1.rows);
    rows[5].paid_in = 1;
    assert.throws(() => assertRowsIntact(rows, F1.summary), isIncompleteTransactions);
  });

  test("H-5 rejects an amount that isn't a finite number", () => {
    const rows = structuredClone(F1.rows);
    rows[3].paid_out = null;
    assert.throws(() => assertRowsIntact(rows, F1.summary), isIncompleteTransactions);
  });
});
