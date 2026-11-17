// The Money In area's figures (IA migration Stage 7f): where money came from,
// from the API's money in and the Stage 4b statement model, each with the
// Ledger scope its door opens (DR-10, I-4). Sources are the DR-6 inflow
// buckets, as on Overview (reversals gross, Q-D3; unknown or unexpected rows
// in "Other money in", Q-D10; zero-total buckets hidden). Decisions: Q-LINK
// (charges display only), Q-D9 (T-LOADFAIL, T-UNVERIFIED). Amounts are
// integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { linkCharges, linkedChargesByParent } from "@/lib/statement/charges";
import { NO_ENTITY } from "@/lib/statement/groups";
import { breakdown, type BreakdownItem } from "@/lib/statement/overview";
import { toCents, type BucketId, type StatementRow } from "@/lib/statement/rows";
import { compareWithApi, inflowSources } from "@/lib/statement/totals";

/** One source of money in (a DR-6 bucket): Overview's breakdown item and how many rows it holds. */
export type SourceFigure = BreakdownItem & { count: number };

/** One of the largest payments in, its source, and the charge linked to it (display only), opening its receipt. */
export type PaymentFigure = { receiptNo: string; label: string; bucket: BucketId; cents: number; chargeCents: number; time: string; scopeId: string };

/** The derived Money In figures, or withheld when the rows' inflow disagrees with the API's (U-1, T-UNVERIFIED). */
export type MoneyInBreakdown =
  | {
      status: "shown";
      /** Rows that brought money in. */
      count: number;
      /** In DR-6 order; sources without rows are left out. */
      sources: SourceFigure[];
      payments: PaymentFigure[];
    }
  | { status: "unverified" };

export type MoneyInFigures = {
  /** The API's money in (`cash_flow.total_inflow`) and the scope of every inflow row: always available. */
  api: { cents: number; scopeId: string };
  /** null without rows (T-LOADFAIL). */
  breakdown: MoneyInBreakdown | null;
};

/** Payments listed as the largest. */
const PAYMENTS_SHOWN = 5;

/** The PAYMENTS_SHOWN largest inflow rows by principal (a stable sort, so ties keep statement order), each with its linked charge. */
function largestPayments(inflows: StatementRow[], rows: StatementRow[]): PaymentFigure[] {
  const chargesByParent = linkedChargesByParent(rows, linkCharges(rows));
  return [...inflows]
    .sort((a, b) => b.principalCents - a.principalCents)
    .slice(0, PAYMENTS_SHOWN)
    .map((row) => ({
      receiptNo: row.receiptNo,
      label: row.entity === NO_ENTITY ? "Not identified" : row.entity,
      bucket: row.bucket,
      cents: row.principalCents,
      chargeCents: chargesByParent.get(row.id) ?? 0,
      time: row.source.completion_time,
      scopeId: `receipt:${row.receiptNo}`,
    }));
}

/**
 * Every figure the Money In area shows for one import. The API's money in
 * stands on its own; without rows (still loading, or failed: T-LOADFAIL)
 * nothing else is shown. With rows, every derived figure is withheld unless
 * the rows' inflow equals the API's `total_inflow` exactly (U-1,
 * T-UNVERIFIED).
 */
export function moneyInFigures({ analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): MoneyInFigures {
  const api = { cents: toCents(analytics.cash_flow.total_inflow), scopeId: "money-in" };
  if (rows === null) return { api, breakdown: null };
  if (!compareWithApi(rows, analytics).inflow.agrees) return { api, breakdown: { status: "unverified" } };

  const inflows = rows.filter((row) => row.direction === "in");
  const totals = inflowSources(rows);
  return {
    api,
    breakdown: {
      status: "shown",
      count: inflows.length,
      sources: breakdown(totals, api.cents).items.map((item, index) => ({ ...item, count: totals[index].rowIds.length })),
      payments: largestPayments(inflows, rows),
    },
  };
}
