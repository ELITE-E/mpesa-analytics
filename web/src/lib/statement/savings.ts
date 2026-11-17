// The Savings & Investments area's figures (IA migration Stage 7d): money set
// aside, from the API's investment totals and the Stage 4b statement model,
// each with the Ledger scope its door opens (DR-10, I-4). Set aside is the
// engine's INVESTMENT rows (unit-trust deposits), the Set-aside bucket; places
// are its rows by exact stored entity (DR-8). Decisions: Q-LINK (charges
// display only), Q-D9 (T-LOADFAIL, T-UNVERIFIED). Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { linkCharges, linkedChargesByParent } from "@/lib/statement/charges";
import { groupsInBucket, NO_ENTITY } from "@/lib/statement/groups";
import { toCents, type StatementRow } from "@/lib/statement/rows";
import { compareWithApi, share } from "@/lib/statement/totals";

/** One place money was set aside (a DR-8 group of the Set-aside bucket), with its DR-7 share of the total. */
export type PlaceFigure = { entity: string; label: string; cents: number; count: number; share: number | null; scopeId: string };

/** One calendar month's deposits ("YYYY-MM"; null for deposits whose time can't be read). */
export type MonthFigure = { month: string | null; cents: number; count: number };

/** One of the largest deposits, with the charge linked to it (display only), opening its receipt. */
export type DepositFigure = { receiptNo: string; entity: string; label: string; cents: number; chargeCents: number; time: string; scopeId: string };

/** The derived Savings figures, or withheld when the rows disagree with the API's total (T-UNVERIFIED). */
export type SavingsBreakdown =
  | {
      status: "shown";
      /** The Set-aside bucket: principal, deposits, identified places, scope. */
      total: { cents: number; count: number; places: number; scopeId: string };
      /** DR-7 share of the rows' money in; withheld (unverified, null) when U-1 disagrees. */
      shareOfIn: { verified: boolean; share: number | null };
      /** By total set aside, largest first (ties keep first appearance). */
      places: PlaceFigure[];
      /** Oldest month first; unreadable times last. */
      months: MonthFigure[];
      deposits: DepositFigure[];
      /** Charges linked to deposits (Q-LINK, display only; counted in Fees): their sum and how many deposits carried one. */
      depositCharges: { cents: number; count: number };
    }
  | { status: "unverified" };

export type SavingsFigures = {
  /** The API's total set aside (`investments.total_investment`): always available. */
  api: { totalCents: number };
  /** null without rows (T-LOADFAIL). */
  breakdown: SavingsBreakdown | null;
};

/** Deposits listed as the largest. */
const DEPOSITS_SHOWN = 5;

/** The deposits of each calendar month, oldest first, with unreadable times in a last "null" month. */
function monthsOf(deposits: StatementRow[]): MonthFigure[] {
  const months = new Map<string | null, MonthFigure>();
  for (const row of deposits) {
    const month = row.completedAt ? row.completedAt.date.slice(0, 7) : null;
    const figure = months.get(month) ?? { month, cents: 0, count: 0 };
    figure.cents += row.principalCents;
    figure.count += 1;
    months.set(month, figure);
  }
  return [...months.values()].sort((a, b) => (a.month === null ? 1 : b.month === null ? -1 : a.month.localeCompare(b.month)));
}

/** The DEPOSITS_SHOWN largest deposits by principal (a stable sort, so ties keep statement order), each with its linked charge. */
function largestDeposits(deposits: StatementRow[], chargesByParent: Map<number, number>): DepositFigure[] {
  return [...deposits]
    .sort((a, b) => b.principalCents - a.principalCents)
    .slice(0, DEPOSITS_SHOWN)
    .map((row) => ({
      receiptNo: row.receiptNo,
      entity: row.entity,
      label: row.entity === NO_ENTITY ? "Not identified" : row.entity,
      cents: row.principalCents,
      chargeCents: chargesByParent.get(row.id) ?? 0,
      time: row.source.completion_time,
      scopeId: `receipt:${row.receiptNo}`,
    }));
}

/**
 * Every figure the Savings area shows for one import. The API's total stands
 * on its own; without rows (still loading, or failed: T-LOADFAIL) nothing
 * else is shown. With rows, every derived figure is withheld unless the
 * Set-aside bucket equals the API's `total_investment` exactly
 * (T-UNVERIFIED); the share of money in is withheld alone when the rows'
 * inflow disagrees with the API's (U-1, Q-D9).
 */
export function savingsFigures({ analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): SavingsFigures {
  const api = { totalCents: toCents(analytics.investments.total_investment.investment_amount) };
  if (rows === null) return { api, breakdown: null };

  const groups = groupsInBucket(rows, "set-aside");
  const deposits = rows.filter((row) => row.bucket === "set-aside");
  const totalCents = deposits.reduce((total, row) => total + row.principalCents, 0);
  if (totalCents !== api.totalCents) return { api, breakdown: { status: "unverified" } };

  const inflow = compareWithApi(rows, analytics).inflow;
  const chargesByParent = linkedChargesByParent(rows, linkCharges(rows));
  const charged = deposits.filter((row) => (chargesByParent.get(row.id) ?? 0) > 0);
  return {
    api,
    breakdown: {
      status: "shown",
      total: { cents: totalCents, count: deposits.length, places: groups.filter((group) => group.entity !== NO_ENTITY).length, scopeId: "bucket:set-aside" },
      shareOfIn: inflow.agrees ? { verified: true, share: share(totalCents, inflow.rowsCents) } : { verified: false, share: null },
      places: groups
        .map((group) => ({
          entity: group.entity,
          label: group.label,
          cents: group.cents,
          count: group.rowIds.length,
          share: share(group.cents, totalCents),
          scopeId: `group:set-aside:${group.entity}`,
        }))
        .sort((a, b) => b.cents - a.cents),
      months: monthsOf(deposits),
      deposits: largestDeposits(deposits, chargesByParent),
      depositCharges: { cents: charged.reduce((total, row) => total + (chargesByParent.get(row.id) ?? 0), 0), count: charged.length },
    },
  };
}
