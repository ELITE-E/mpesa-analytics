// The Breakdown hub's figures (IA migration Stage 8a): each area's headline
// and the "adds up" card, from the API's money in and out and Overview's
// allocation (DR-5, `breakdown()` in overview.ts), so the hub and Overview
// cannot disagree. Every outflow bucket with rows is a part, supported by an
// area or not; a bucket without rows is left out. Q-D9: T-LOADFAIL,
// T-UNVERIFIED. Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { breakdown, type BreakdownItem } from "@/lib/statement/overview";
import { toCents, type OutflowBucket, type StatementRow } from "@/lib/statement/rows";
import { compareWithApi, outflowAllocation, share } from "@/lib/statement/totals";

/** The Breakdown areas money goes out through, by the DR-3 bucket each one's headline is. */
export const AREA_BUCKETS = {
  spending: "spending",
  people: "sent-to-people",
  savings: "set-aside",
  cash: "cash-withdrawn",
  fees: "charges",
} as const satisfies Record<string, OutflowBucket>;

export type OutflowArea = keyof typeof AREA_BUCKETS;

/** One outflow bucket: Overview's breakdown item (principal, DR-7 share of money out, scope) and its row count. */
export type PartFigure = BreakdownItem & { count: number };

/** One area's headline: its bucket's principal, rows, share of money out and scope; zero when the bucket has no rows. */
export type AreaFigure = { cents: number; count: number; share: number | null; scopeId: string };

/** The derived hub figures, or withheld when the rows' outflow or charges disagree with the API's (U-2, U-3: T-UNVERIFIED). */
export type HubBreakdown =
  | {
      status: "shown";
      areas: Record<OutflowArea, AreaFigure>;
      /** Every outflow bucket with rows, in allocation order; they add up to money out (I-1). */
      parts: PartFigure[];
      /** Whether the rows' inflow equals the API's (U-1): money in is a door only then. */
      inflowVerified: boolean;
      /** Rows that brought money in. */
      inflowCount: number;
    }
  | { status: "unverified" };

export type HubFigures = {
  /** The API's money out (`total_outflow`, charges included) and in (`total_inflow`), with their scopes: always available. */
  moneyOut: { cents: number; scopeId: string };
  moneyIn: { cents: number; scopeId: string };
  /** null without rows (T-LOADFAIL). */
  breakdown: HubBreakdown | null;
};

/**
 * Every figure the Breakdown hub shows for one import. The API's money out
 * and in stand on their own; without rows (still loading, or failed:
 * T-LOADFAIL) nothing else is shown. With rows, the areas and parts are
 * withheld when the rows' outflow or charges disagree with the API's (U-2,
 * U-3), exactly as Overview's allocation is.
 */
export function hubFigures({ analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): HubFigures {
  const moneyOut = { cents: toCents(analytics.cash_flow.total_outflow), scopeId: "money-out" };
  const moneyIn = { cents: toCents(analytics.cash_flow.total_inflow), scopeId: "money-in" };
  if (rows === null) return { moneyOut, moneyIn, breakdown: null };
  const comparison = compareWithApi(rows, analytics);
  if (!comparison.outflow.agrees || !comparison.charges.agrees) return { moneyOut, moneyIn, breakdown: { status: "unverified" } };

  const totals = outflowAllocation(rows);
  const parts = breakdown(totals, moneyOut.cents).items.map((item, index) => ({ ...item, count: totals[index].rowIds.length }));
  const areaOf = (bucket: OutflowBucket): AreaFigure => {
    const part = parts.find((candidate) => candidate.bucket === bucket);
    return part ? { cents: part.cents, count: part.count, share: part.share, scopeId: part.scopeId } : { cents: 0, count: 0, share: share(0, moneyOut.cents), scopeId: `bucket:${bucket}` };
  };
  return {
    moneyOut,
    moneyIn,
    breakdown: {
      status: "shown",
      areas: {
        spending: areaOf(AREA_BUCKETS.spending),
        people: areaOf(AREA_BUCKETS.people),
        savings: areaOf(AREA_BUCKETS.savings),
        cash: areaOf(AREA_BUCKETS.cash),
        fees: areaOf(AREA_BUCKETS.fees),
      },
      parts,
      inflowVerified: comparison.inflow.agrees,
      inflowCount: rows.filter((row) => row.direction === "in").length,
    },
  };
}
