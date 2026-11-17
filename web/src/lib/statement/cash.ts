// The Cash area's figures (IA migration Stage 7e): cash taken out at agents,
// from the Stage 4b statement model, each with the Ledger scope its door
// opens (DR-10, I-4). Cash withdrawn is the Cash-withdrawn bucket (DR-3:
// WITHDRAWAL rows going out); agents are its rows by exact stored entity
// (DR-8). The API has no withdrawal total, so the figures stand on the U-2
// and U-3 comparisons, as Spending's do. Decisions: Q-LINK (charges display
// only), Q-D9 (T-LOADFAIL, T-UNVERIFIED). Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { linkCharges, linkedChargesByParent } from "@/lib/statement/charges";
import { groupsInBucket, NO_ENTITY } from "@/lib/statement/groups";
import type { StatementRow } from "@/lib/statement/rows";
import { compareWithApi, share } from "@/lib/statement/totals";

/**
 * One agent (a DR-8 group of the Cash-withdrawn bucket): its withdrawals and
 * its DR-7 share of the cash withdrawn. No per-agent charge: the agent's door
 * opens its withdrawals only, and a charge shown on it would read as part of
 * that door (Q-LINK: charges are display only).
 */
export type AgentFigure = { entity: string; label: string; cents: number; count: number; share: number | null; scopeId: string };

/** One of the largest withdrawals, with the charge linked to it (display only), opening its receipt. */
export type WithdrawalFigure = { receiptNo: string; entity: string; label: string; cents: number; chargeCents: number; time: string; scopeId: string };

/** The Cash figures, or withheld when the rows' outflow or charges disagree with the API's (T-UNVERIFIED). */
export type CashBreakdown =
  | {
      status: "shown";
      /** The Cash-withdrawn bucket: principal, withdrawals, identified agents, scope. */
      total: { cents: number; count: number; agents: number; scopeId: string };
      /** Charges linked to withdrawals (Q-LINK, display only; counted in Fees): sum, withdrawals carrying one, DR-7 share of the cash withdrawn. */
      charges: { cents: number; count: number; share: number | null };
      /** By cash withdrawn, largest first (ties keep first appearance). */
      agents: AgentFigure[];
      withdrawals: WithdrawalFigure[];
    }
  | { status: "unverified" };

export type CashFigures = {
  /** null without rows (T-LOADFAIL): the API has no Cash figure of its own. */
  breakdown: CashBreakdown | null;
};

/** Withdrawals listed as the largest. */
const WITHDRAWALS_SHOWN = 5;

/** The WITHDRAWALS_SHOWN largest withdrawals by principal (a stable sort, so ties keep statement order), each with its linked charge. */
function largestWithdrawals(rows: StatementRow[], chargesByParent: Map<number, number>): WithdrawalFigure[] {
  return [...rows]
    .sort((a, b) => b.principalCents - a.principalCents)
    .slice(0, WITHDRAWALS_SHOWN)
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
 * Every figure the Cash area shows for one import. Without rows (still
 * loading, or failed: T-LOADFAIL) there is none. With rows, every figure is
 * withheld when the rows' outflow or charges disagree with the API's
 * `total_outflow` or `total_fees` (U-2, U-3: T-UNVERIFIED), as on Spending.
 */
export function cashFigures({ analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): CashFigures {
  if (rows === null) return { breakdown: null };
  const comparison = compareWithApi(rows, analytics);
  if (!comparison.outflow.agrees || !comparison.charges.agrees) return { breakdown: { status: "unverified" } };

  const withdrawals = rows.filter((row) => row.bucket === "cash-withdrawn");
  const totalCents = withdrawals.reduce((total, row) => total + row.principalCents, 0);
  const chargesByParent = linkedChargesByParent(rows, linkCharges(rows));
  const chargeOf = (id: number) => chargesByParent.get(id) ?? 0;
  const charged = withdrawals.filter((row) => chargeOf(row.id) > 0);
  const chargeCents = charged.reduce((total, row) => total + chargeOf(row.id), 0);
  const groups = groupsInBucket(rows, "cash-withdrawn");
  return {
    breakdown: {
      status: "shown",
      total: { cents: totalCents, count: withdrawals.length, agents: groups.filter((group) => group.entity !== NO_ENTITY).length, scopeId: "bucket:cash-withdrawn" },
      charges: { cents: chargeCents, count: charged.length, share: share(chargeCents, totalCents) },
      agents: groups
        .map((group) => ({
          entity: group.entity,
          label: group.label,
          cents: group.cents,
          count: group.rowIds.length,
          share: share(group.cents, totalCents),
          scopeId: `group:cash-withdrawn:${group.entity}`,
        }))
        .sort((a, b) => b.cents - a.cents),
      withdrawals: largestWithdrawals(withdrawals, chargesByParent),
    },
  };
}
