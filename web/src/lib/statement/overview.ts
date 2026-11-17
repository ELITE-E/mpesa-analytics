// Overview's figures (IA migration Stage 6), composed from the API's values
// (rev2 R2.3) and the Stage 4b statement model, each with the Ledger scope its
// door opens (DR-10, I-4). Decisions: Q-D4 (largest transactions), Q-D5
// (statement lines), Q-D6 (O1 shown, O2 the check), Q-D9 (T-LOADFAIL,
// T-UNVERIFIED). Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { openingBalance, type OpeningBalance } from "@/lib/statement/balances";
import { linkedChargesByParent, linkCharges } from "@/lib/statement/charges";
import { toCents, type BucketId, type StatementRow } from "@/lib/statement/rows";
import { compareWithApi, inflowSources, outflowAllocation, share, type BucketTotal } from "@/lib/statement/totals";

/** An API figure and the Ledger scope its door opens. */
export type DoorFigure = { cents: number; scopeId: string };

/** One bucket of a breakdown: its principal, its DR-7 share (null for a zero whole) and its scope. */
export type BreakdownItem = { bucket: BucketId; cents: number; share: number | null; scopeId: string };

/**
 * A row-derived breakdown (DR-5 or DR-6): shown, adding up to `totalCents`;
 * or withheld because the rows' total disagrees with the API's (T-UNVERIFIED).
 */
export type Breakdown = { status: "shown"; totalCents: number; items: BreakdownItem[] } | { status: "unverified" };

/** One of the largest transactions (Q-D4), with the receipt scope it opens. */
export type LargestEvent = {
  kind: "purchase" | "inflow" | "send";
  receiptNo: string;
  entity: string;
  /** A purchase: the API's amount incl. charges, as calculated at import. Otherwise the principal. */
  cents: number;
  /** The charges linked to an inflow or send (DR-2, display only); 0 for a purchase, whose amount includes them. */
  chargeCents: number;
  /** The completion time as the statement states it. */
  time: string;
  scopeId: string;
};

export type OverviewFigures = {
  /** Statement lines stored, charge lines included (Q-D5). */
  lineCount: number;
  moneyIn: DoorFigure;
  moneyOut: DoorFigure;
  netCents: number;
  closingCents: number;
  /** null without rows (T-LOADFAIL). */
  bridge: { opening: OpeningBalance } | null;
  allocation: Breakdown | null;
  sources: Breakdown | null;
  review: {
    /** The import's own count (per incoming row), always shown. */
    apiCount: number;
    /** The stored unclassified rows and their amounts per direction; null without rows. */
    rows: { count: number; inCents: number; outCents: number; scopeId: string } | null;
    /** U-5: whether the stored rows' count equals the import's; null without rows. */
    countsAgree: boolean | null;
  };
  largest: {
    purchases: LargestEvent[];
    /** The largest inflow and send from the rows; null without rows. */
    derived: LargestEvent[] | null;
  };
};

/** The largest purchases the API lists, at most three (Q-D4). */
const PURCHASES_SHOWN = 3;

/** A breakdown of `totals` against `wholeCents`, each bucket with its DR-7 share and bucket scope (also Money In's sources, Stage 7f). */
export function breakdown(totals: BucketTotal[], wholeCents: number): Extract<Breakdown, { status: "shown" }> {
  return {
    status: "shown",
    totalCents: wholeCents,
    items: totals.map((total) => ({ bucket: total.bucket, cents: total.cents, share: share(total.cents, wholeCents), scopeId: `bucket:${total.bucket}` })),
  };
}

/** The row of `rows` with the largest principal (the earliest on a tie), or null. */
function largestRow(rows: StatementRow[]) {
  return rows.reduce<StatementRow | null>((best, row) => (best === null || row.principalCents > best.principalCents ? row : best), null);
}

/** The largest inflow and the largest send (Q-D4), each with the charges linked to it. */
function largestFromRows(rows: StatementRow[]): LargestEvent[] {
  const charges = linkedChargesByParent(rows, linkCharges(rows));
  const picks: [LargestEvent["kind"], StatementRow | null][] = [
    ["inflow", largestRow(rows.filter((row) => row.direction === "in" && !row.isCharge))],
    ["send", largestRow(rows.filter((row) => row.bucket === "sent-to-people"))],
  ];
  return picks.flatMap(([kind, row]) =>
    row
      ? [{
          kind,
          receiptNo: row.receiptNo,
          entity: row.entity,
          cents: row.principalCents,
          chargeCents: charges.get(row.id) ?? 0,
          time: row.source.completion_time,
          scopeId: `receipt:${row.receiptNo}`,
        }]
      : [],
  );
}

/**
 * Every figure Overview shows for one import. The API's values stand on their
 * own; with `rows` null (still loading, or failed: T-LOADFAIL) every
 * row-derived figure is null. With rows, the allocation is withheld when the
 * rows' outflow or charges disagree with the API's (U-2, U-3) and the sources
 * when their inflow does (U-1): T-UNVERIFIED, never an adjusted figure.
 */
export function overviewFigures({ summary, analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): OverviewFigures {
  const flow = analytics.cash_flow;
  const moneyIn = { cents: toCents(flow.total_inflow), scopeId: "money-in" };
  const moneyOut = { cents: toCents(flow.total_outflow), scopeId: "money-out" };
  const purchases: LargestEvent[] = analytics.spending.largest_purchases.slice(0, PURCHASES_SHOWN).map((item) => ({
    kind: "purchase",
    receiptNo: item.transaction,
    entity: item.recipient,
    cents: toCents(item.amount),
    chargeCents: 0,
    time: item.date,
    scopeId: `receipt:${item.transaction}`,
  }));
  const figures: OverviewFigures = {
    lineCount: summary.transaction_count,
    moneyIn,
    moneyOut,
    netCents: toCents(flow.net_cash_flow),
    closingCents: toCents(flow.closing_balance),
    bridge: null,
    allocation: null,
    sources: null,
    review: { apiCount: summary.unclassified_transaction_count, rows: null, countsAgree: null },
    largest: { purchases, derived: null },
  };
  if (rows === null) return figures;

  const comparison = compareWithApi(rows, analytics);
  const unclassified = rows.filter((row) => row.eventType === "UNCLASSIFIED");
  return {
    ...figures,
    bridge: { opening: openingBalance(rows, flow) },
    allocation: comparison.outflow.agrees && comparison.charges.agrees ? breakdown(outflowAllocation(rows), moneyOut.cents) : { status: "unverified" },
    sources: comparison.inflow.agrees ? breakdown(inflowSources(rows), moneyIn.cents) : { status: "unverified" },
    review: {
      apiCount: summary.unclassified_transaction_count,
      rows: {
        count: unclassified.length,
        inCents: unclassified.reduce((total, row) => total + toCents(row.source.paid_in), 0),
        outCents: unclassified.reduce((total, row) => total + toCents(row.source.paid_out), 0),
        scopeId: "unclassified",
      },
      countsAgree: unclassified.length === summary.unclassified_transaction_count,
    },
    largest: { purchases, derived: largestFromRows(rows) },
  };
}
