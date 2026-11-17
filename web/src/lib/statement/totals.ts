// Allocation and sources (DR-5, DR-6), shares (DR-7) and daily average (DR-9)
// of the IA migration plan (rev1 §1.2), with the comparisons against the API's
// totals (rev2 R2 U-1..U-3). Sums are exact, in integer cents.

import type { AnalyticsResult } from "@/lib/api";
import {
  INFLOW_BUCKETS,
  OUTFLOW_BUCKETS,
  parseCompletionTime,
  toCents,
  type BucketId,
  type StatementRow,
} from "@/lib/statement/rows";

/** One bucket's principal and the rows it was made from. */
export type BucketTotal = { bucket: BucketId; cents: number; rowIds: number[] };

/** The rows of `rows` in each of `order`'s buckets, summed; buckets without rows are left out. */
function partition(rows: StatementRow[], order: BucketId[]): BucketTotal[] {
  return order
    .map((bucket) => {
      const members = rows.filter((row) => row.bucket === bucket);
      return { bucket, cents: members.reduce((total, row) => total + row.principalCents, 0), rowIds: members.map((row) => row.id) };
    })
    .filter((total) => total.rowIds.length > 0);
}

/**
 * DR-5: where the money went. Every OUTFLOW row in exactly one DR-3 bucket,
 * every `FEE` row (linked or not) in Charges, measured by `paid_out`; the
 * buckets add up to the rows' outflow (I-1).
 */
export function outflowAllocation(rows: StatementRow[]): BucketTotal[] {
  return partition(rows.filter((row) => row.direction === "out"), OUTFLOW_BUCKETS);
}

/** DR-6: where the money came from. Every INFLOW row in exactly one DR-3 bucket, measured by `paid_in` (I-2). */
export function inflowSources(rows: StatementRow[]): BucketTotal[] {
  return partition(rows.filter((row) => row.direction === "in"), INFLOW_BUCKETS);
}

/** A sum over the rows set against the API's figure for it. */
export type TotalComparison = { rowsCents: number; apiCents: number; agrees: boolean };

/** Compare `rowsCents` with an API amount, exactly to the cent. */
function compare(rowsCents: number, apiAmount: number): TotalComparison {
  const apiCents = toCents(apiAmount);
  return { rowsCents, apiCents, agrees: rowsCents === apiCents };
}

/**
 * The rows' inflow, outflow and charges against the API's `total_inflow`,
 * `total_outflow` and `total_fees` (rev2 U-1..U-3). A difference can be
 * legitimate (identical rows collapse into one stored row, rev2 V-3), so it is
 * reported with both values and never adjusted.
 */
export function compareWithApi(rows: StatementRow[], analytics: AnalyticsResult) {
  const total = (members: StatementRow[]) => members.reduce((sum, row) => sum + row.principalCents, 0);
  return {
    inflow: compare(total(rows.filter((row) => row.direction === "in")), analytics.cash_flow.total_inflow),
    outflow: compare(total(rows.filter((row) => row.direction === "out")), analytics.cash_flow.total_outflow),
    charges: compare(total(rows.filter((row) => row.isCharge && row.direction === "out")), analytics.fees.total_fees.total_fees),
  };
}

/**
 * DR-7: `partCents` as a percentage of `wholeCents`, to one decimal place,
 * rounded half up; null when the whole is zero (shown "N/A", never "0%").
 * Both are non-negative integer cents (principal sums). In tenths of a
 * percent the share is 1000·part/whole; it is rounded as
 * ⌊(2000·part + whole) / (2·whole)⌋ in exact integer (BigInt) arithmetic, so
 * no floating-point quotient can cross a half-way point, at any amount.
 * Shares of a partition need not add up to 100.0.
 */
export function share(partCents: number, wholeCents: number): number | null {
  if (wholeCents === 0) return null;
  const part = BigInt(partCents);
  const whole = BigInt(wholeCents);
  return Number((BigInt(2000) * part + whole) / (BigInt(2) * whole)) / 10;
}

/** A calendar date "YYYY-MM-DD" as a UTC day number; null if it isn't a real date. */
function dayNumber(isoDate: string) {
  const parsed = parseCompletionTime(`${isoDate} 00:00:00`);
  return parsed ? Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))) / 86_400_000 : null;
}

/**
 * DR-9: `cents` spread over the inclusive days from `periodStart` to
 * `periodEnd` (calendar dates of the earliest and latest transaction, plan
 * A-13); a single-day period is one day. Unrounded cents; null for a period
 * that isn't a valid date range.
 */
export function dailyAverageCents(cents: number, periodStart: string, periodEnd: string): number | null {
  const first = dayNumber(periodStart);
  const last = dayNumber(periodEnd);
  if (first === null || last === null || last < first) return null;
  return cents / (last - first + 1);
}
