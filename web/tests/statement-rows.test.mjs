// Statement domain, rows (IA migration Stage 4b; plan rev1 §1.2–1.3):
//   DR-1 row view: direction from `cash_flow_direction`, amount = principal in
//        integer cents, `completion_time` parsed from "YYYY-MM-DD HH:MM:SS" or
//        "YYYY-MM-DDTHH:MM:SS" with no timezone conversion; an unparseable
//        time is flagged and the row stays (it is never dropped);
//   DR-3 direction-first bucketing over the 13 event types of
//        src/event_types.py, unknown types and unexpected directions going to
//        "Other" for their direction.
// Rows come from the contract fixtures (support/contract-fixtures.mjs).
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-rows.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { EVENT_TYPES, bucketOf, parseCompletionTime, toStatementRow } = await import("../src/lib/statement/rows.ts");

const FIXTURES = contractFixtures();
// The core's event types: the members of FinancialEvent in its taxonomy (CP8b: the old backend's
// src/event_types.py is now mpesa_core/classification/taxonomy.py, which also holds other enums).
const TAXONOMY = readFileSync(new URL("../../src/mpesa_core/classification/taxonomy.py", import.meta.url), "utf8");
const BACKEND_EVENT_TYPES = [
  ...TAXONOMY.split("class FinancialEvent")[1].split("\nclass ")[0].matchAll(/^\s+([A-Z_]+) = "\1"$/gm),
].map((match) => match[1]);

/** The DR-3 bucket table (plan rev1 §1.3), one entry per event type and direction. */
const BUCKET_TABLE = {
  out: {
    MERCHANT_PAYMENT: "spending",
    BILL_PAYMENT: "spending",
    BUNDLE_PURCHASE: "spending",
    AIRTIME_PURCHASE: "airtime",
    TRANSFER_OUT: "sent-to-people",
    INVESTMENT: "set-aside",
    WITHDRAWAL: "cash-withdrawn",
    UNCLASSIFIED: "not-classified-out",
    REVERSAL: "reversals-out",
    LOAN_REPAYMENT: "loan-repayments",
    FEE: "charges",
    TRANSFER_IN: "other-out",
    DEPOSIT: "other-out",
  },
  in: {
    TRANSFER_IN: "from-people",
    DEPOSIT: "cash-deposits",
    REVERSAL: "reversals-in",
    UNCLASSIFIED: "not-classified-in",
    MERCHANT_PAYMENT: "other-in",
    BILL_PAYMENT: "other-in",
    BUNDLE_PURCHASE: "other-in",
    AIRTIME_PURCHASE: "other-in",
    TRANSFER_OUT: "other-in",
    INVESTMENT: "other-in",
    WITHDRAWAL: "other-in",
    LOAN_REPAYMENT: "other-in",
    FEE: "other-in",
  },
};

describe("DR-3 event types", () => {
  test("knows exactly the backend's 13 event types", () => {
    assert.equal(BACKEND_EVENT_TYPES.length, 13);
    assert.deepEqual([...EVENT_TYPES].sort(), [...BACKEND_EVENT_TYPES].sort());
  });

  test("buckets every event type in both directions per the rev1 table", () => {
    for (const direction of ["out", "in"]) {
      for (const eventType of BACKEND_EVENT_TYPES) {
        assert.equal(bucketOf(direction, eventType), BUCKET_TABLE[direction][eventType], `${direction} ${eventType}`);
      }
    }
  });

  test("puts an unknown or future event type in Other for its direction", () => {
    assert.equal(bucketOf("out", "FULIZA_DRAWDOWN"), "other-out");
    assert.equal(bucketOf("in", "FULIZA_DRAWDOWN"), "other-in");
  });
});

describe("DR-1 completion time", () => {
  test("parses both supported formats to the same statement-local date and time", () => {
    const expected = { date: "2026-07-04", time: "10:00:00" };
    assert.deepEqual(parseCompletionTime("2026-07-04 10:00:00"), expected);
    assert.deepEqual(parseCompletionTime("2026-07-04T10:00:00"), expected);
  });

  test("rejects the fixtures' invalid strings and impossible calendar values", () => {
    for (const raw of ["04/07/2026 12:00", "", "2026-13-45 99:99:99", "not a timestamp", "2026-02-30 10:00:00", "2026-07-04 24:00:00", "2026-07-04 10:00", "2026-07-04 10:00:00Z"]) {
      assert.equal(parseCompletionTime(raw), null, JSON.stringify(raw));
    }
  });
});

describe("DR-1 row view", () => {
  const rows = FIXTURES["F1-worked-example"].rows;

  test("keeps the row's identity and source, and takes direction and principal from the API row", () => {
    for (const transaction of rows) {
      const row = toStatementRow(transaction);
      assert.equal(row.id, transaction.id);
      assert.equal(row.receiptNo, transaction.receipt_no);
      assert.equal(row.entity, transaction.entity);
      assert.equal(row.eventType, transaction.event_type);
      assert.equal(row.source, transaction, "the API record itself is kept as provenance");
      assert.equal(row.direction, transaction.cash_flow_direction === "INFLOW" ? "in" : "out");
      const principal = row.direction === "in" ? transaction.paid_in : transaction.paid_out;
      assert.equal(row.principalCents, Math.round(principal * 100));
      assert.equal(row.isCharge, transaction.event_type === "FEE");
      assert.equal(row.bucket, BUCKET_TABLE[row.direction][transaction.event_type]);
    }
  });

  test("an unexpected direction lands in Other (F1 row 5: a merchant payment coming in)", () => {
    const refund = toStatementRow(rows.find((t) => t.id === 5));
    assert.equal(refund.bucket, "other-in");
    assert.equal(refund.principalCents, 8000);
  });

  test("an unparseable time is flagged, not dropped (F3)", () => {
    const viewed = FIXTURES["F3-invalid-timestamps"].rows.map(toStatementRow);
    assert.equal(viewed.length, FIXTURES["F3-invalid-timestamps"].rows.length);
    assert.deepEqual(viewed.map((row) => row.completedAt === null), [false, false, true, true, true, true]);
    assert.ok(viewed.every((row) => Number.isInteger(row.principalCents)));
  });
});
