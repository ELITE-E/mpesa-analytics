// Statement rows: the row view (DR-1) and direction-first buckets (DR-3) of
// the IA migration plan (rev1 §1.2–1.3). Pure functions over the API's
// transaction rows; money is held in integer cents.

import type { Transaction } from "@/lib/api";

/** The 13 financial events the engine recognises (src/event_types.py). */
export const EVENT_TYPES = [
  "MERCHANT_PAYMENT",
  "BILL_PAYMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "WITHDRAWAL",
  "DEPOSIT",
  "INVESTMENT",
  "LOAN_REPAYMENT",
  "AIRTIME_PURCHASE",
  "BUNDLE_PURCHASE",
  "REVERSAL",
  "FEE",
  "UNCLASSIFIED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type Direction = "in" | "out";

/** Where money went (DR-5) or came from (DR-6); one per row. */
export type OutflowBucket =
  | "spending"
  | "airtime"
  | "sent-to-people"
  | "set-aside"
  | "cash-withdrawn"
  | "not-classified-out"
  | "reversals-out"
  | "loan-repayments"
  | "charges"
  | "other-out";
export type InflowBucket = "from-people" | "cash-deposits" | "reversals-in" | "not-classified-in" | "other-in";
export type BucketId = OutflowBucket | InflowBucket;

/** Every outflow bucket, in allocation order: the rev1 §1.3 table, Charges last. */
export const OUTFLOW_BUCKETS: OutflowBucket[] = [
  "spending",
  "airtime",
  "sent-to-people",
  "set-aside",
  "cash-withdrawn",
  "not-classified-out",
  "reversals-out",
  "loan-repayments",
  "other-out",
  "charges",
];

/** Every inflow bucket (source), in the rev1 §1.3 table's order. */
export const INFLOW_BUCKETS: InflowBucket[] = ["from-people", "cash-deposits", "reversals-in", "not-classified-in", "other-in"];

/** Whether `bucket` holds money coming in (a DR-6 source) rather than going out. */
export function isInflowBucket(bucket: BucketId): bucket is InflowBucket {
  return (INFLOW_BUCKETS as BucketId[]).includes(bucket);
}

/**
 * The DR-3 table: the bucket of each event type in its expected direction.
 * Spending is the backend's spending event set (src/analytics/preparation.py);
 * airtime stays separate (Q-D2), reversals are not netted (Q-D3), and every
 * `FEE` row is a charge. Anything not listed for a direction is unexpected.
 */
const OUTFLOW_BUCKET_OF: Partial<Record<string, OutflowBucket>> = {
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
};
const INFLOW_BUCKET_OF: Partial<Record<string, InflowBucket>> = {
  TRANSFER_IN: "from-people",
  DEPOSIT: "cash-deposits",
  REVERSAL: "reversals-in",
  UNCLASSIFIED: "not-classified-in",
};

/**
 * DR-3: the bucket of a row moving money `direction` with `eventType`. An
 * unknown event type, or one in an unexpected direction (a merchant payment
 * coming in), goes to "Other" for its direction, so every row the API sums
 * lands in exactly one bucket of its side.
 */
export function bucketOf(direction: Direction, eventType: string): BucketId {
  if (direction === "out") return OUTFLOW_BUCKET_OF[eventType] ?? "other-out";
  return INFLOW_BUCKET_OF[eventType] ?? "other-in";
}

/** A completion time as the statement states it: calendar date and 24-hour time, no timezone. */
export type CompletionTime = { date: string; time: string };

const COMPLETION_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * DR-1: parse a `completion_time` of the form "YYYY-MM-DD HH:MM:SS" or
 * "YYYY-MM-DDTHH:MM:SS" (the two forms the API is known to carry, plan A-01)
 * into the statement's own date and time, without any timezone conversion.
 * Any other text, or a date or time that does not exist, is null.
 */
export function parseCompletionTime(text: string): CompletionTime | null {
  const parts = COMPLETION_TIME.exec(text);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const exists =
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second;
  return exists ? { date: `${parts[1]}-${parts[2]}-${parts[3]}`, time: `${parts[4]}:${parts[5]}:${parts[6]}` } : null;
}

/** An API amount in integer cents, so sums are exact (values are 2-decimal KES). */
export function toCents(amount: number) {
  return Math.round(amount * 100);
}

/** DR-1: one statement row as the domain sees it, keeping the API record it came from. */
export type StatementRow = {
  id: number;
  receiptNo: string;
  eventType: string;
  entity: string;
  direction: Direction;
  /** `paid_in` of an inflow or `paid_out` of an outflow, in cents. */
  principalCents: number;
  /** A `FEE` row: a charge in its own right (DR-2, DR-5). */
  isCharge: boolean;
  bucket: BucketId;
  /** null when `completion_time` is not a valid time; the row still counts everywhere. */
  completedAt: CompletionTime | null;
  /** The API row itself (provenance); never modified. */
  source: Transaction;
};

/**
 * DR-1 and DR-3: the domain view of an API transaction. Direction comes from
 * `cash_flow_direction`, the amount is the principal of that direction, and
 * the bucket follows DR-3. Nothing is dropped or altered: an invalid time is
 * only flagged.
 */
export function toStatementRow(transaction: Transaction): StatementRow {
  const direction: Direction = transaction.cash_flow_direction === "INFLOW" ? "in" : "out";
  return {
    id: transaction.id,
    receiptNo: transaction.receipt_no,
    eventType: transaction.event_type,
    entity: transaction.entity,
    direction,
    principalCents: toCents(direction === "in" ? transaction.paid_in : transaction.paid_out),
    isCharge: transaction.event_type === "FEE",
    bucket: bucketOf(direction, transaction.event_type),
    completedAt: parseCompletionTime(transaction.completion_time),
    source: transaction,
  };
}
