// The Fees area's figures (IA migration Stage 7c): what moving money cost,
// from the API's total fees and the Stage 4b statement model, each with the
// Ledger scope its door opens (DR-10, I-4). Decision Q-D7: a charge's cause
// is the transaction it was charged for (DR-2 linkage), by event type; a
// charge not linked to one transaction is its own cause. Q-D9: T-LOADFAIL,
// T-UNVERIFIED. Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { chargeCauses, linkCharges, UNLINKED_CAUSE } from "@/lib/statement/charges";
import { NO_ENTITY } from "@/lib/statement/groups";
import { toCents, type StatementRow } from "@/lib/statement/rows";
import { compareWithApi, share } from "@/lib/statement/totals";

/** One cause of charges (Q-D7: an event type, or UNLINKED_CAUSE): its charges, their DR-7 share of all charges, and its "fees:<cause>" scope. */
export type CauseFigure = { cause: string; cents: number; count: number; share: number | null; scopeId: string };

/** One of the largest charges, its cause and the transaction it was for (null when not linked to one), opening its receipt. */
export type ChargeFigure = {
  receiptNo: string;
  cause: string;
  /** The linked transaction's name ("Not identified" for the engine's marker); null when not linked to one. */
  label: string | null;
  cents: number;
  /** The linked transaction's principal; null when not linked to one. */
  parentCents: number | null;
  time: string;
  scopeId: string;
};

/** The derived Fees figures, or withheld when the FEE rows disagree with the API's total (U-3, T-UNVERIFIED). */
export type FeesBreakdown =
  | {
      status: "shown";
      total: { cents: number; count: number; scopeId: string };
      /** Payments out (non-fee OUTFLOW rows), and how many have a charge linked to them. */
      paymentsOut: number;
      chargedPayments: number;
      /** DR-7 share of the rows' money out (charges included); withheld (unverified, null) when U-2 disagrees. */
      shareOfOut: { verified: boolean; share: number | null };
      /** Largest first; charges not linked to one transaction last. */
      causes: CauseFigure[];
      largest: ChargeFigure[];
      /** Non-fee rows with no charge on their receipt, by direction. */
      free: { outCount: number; inCount: number };
      /** Charges not linked to one transaction (rev2 R1.2 disclosure). */
      unlinkedCount: number;
    }
  | { status: "unverified" };

export type FeesFigures = {
  /** The API's total fees (`fees.total_fees`) and the scope of every FEE row: always available. */
  api: { cents: number; scopeId: string };
  /** null without rows (T-LOADFAIL). */
  breakdown: FeesBreakdown | null;
};

/** Charges listed as the largest. */
const CHARGES_SHOWN = 5;

/** The charges of each cause, largest first (ties keep first appearance) with the unlinked cause last, each with its share of `totalCents`. */
function causesOf(charges: StatementRow[], causeById: Map<number, string>, totalCents: number): CauseFigure[] {
  const byCause = new Map<string, { cents: number; count: number }>();
  for (const fee of charges) {
    const cause = causeById.get(fee.id) as string;
    const figure = byCause.get(cause) ?? { cents: 0, count: 0 };
    figure.cents += fee.principalCents;
    figure.count += 1;
    byCause.set(cause, figure);
  }
  const unlinkedLast = (cause: string) => (cause === UNLINKED_CAUSE ? 1 : 0);
  return [...byCause.entries()]
    .map(([cause, figure]) => ({ cause, ...figure, share: share(figure.cents, totalCents), scopeId: `fees:${cause}` }))
    .sort((a, b) => unlinkedLast(a.cause) - unlinkedLast(b.cause) || b.cents - a.cents);
}

/**
 * Every figure the Fees area shows for one import. The API's total stands on
 * its own; without rows (still loading, or failed: T-LOADFAIL) nothing else
 * is shown. With rows, every derived figure is withheld unless the FEE rows
 * equal the API's `total_fees` (U-3, T-UNVERIFIED); the share of money out is
 * withheld alone when the rows' outflow disagrees with the API's (U-2).
 */
export function feesFigures({ analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): FeesFigures {
  const api = { cents: toCents(analytics.fees.total_fees.total_fees), scopeId: "fees" };
  if (rows === null) return { api, breakdown: null };
  const comparison = compareWithApi(rows, analytics);
  if (!comparison.charges.agrees) return { api, breakdown: { status: "unverified" } };

  const charges = rows.filter((row) => row.isCharge);
  const totalCents = charges.reduce((total, fee) => total + fee.principalCents, 0);
  const links = linkCharges(rows);
  const causeById = chargeCauses(rows);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const parentOf = new Map(links.flatMap((link) => (link.status === "linked" ? [[link.feeId, link.parentId] as const] : [])));
  const charged = new Set(links.flatMap((link) => (link.status === "linked" ? [link.parentId] : link.status === "ambiguous" ? link.candidateIds : [])));
  const payments = rows.filter((row) => !row.isCharge);
  const largest = [...charges]
    .sort((a, b) => b.principalCents - a.principalCents)
    .slice(0, CHARGES_SHOWN)
    .map((fee): ChargeFigure => {
      const parentId = parentOf.get(fee.id);
      const parent = parentId === undefined ? null : (rowById.get(parentId) as StatementRow);
      const cause = causeById.get(fee.id) as string;
      return {
        receiptNo: fee.receiptNo,
        cause,
        label: parent ? (parent.entity === NO_ENTITY ? "Not identified" : parent.entity) : null,
        cents: fee.principalCents,
        parentCents: parent ? parent.principalCents : null,
        time: fee.source.completion_time,
        scopeId: `receipt:${fee.receiptNo}`,
      };
    });
  return {
    api,
    breakdown: {
      status: "shown",
      total: { cents: totalCents, count: charges.length, scopeId: "fees" },
      paymentsOut: payments.filter((row) => row.direction === "out").length,
      chargedPayments: new Set(parentOf.values()).size,
      shareOfOut: comparison.outflow.agrees ? { verified: true, share: share(totalCents, comparison.outflow.rowsCents) } : { verified: false, share: null },
      causes: causesOf(charges, causeById, totalCents),
      largest,
      free: {
        outCount: payments.filter((row) => row.direction === "out" && !charged.has(row.id)).length,
        inCount: payments.filter((row) => row.direction === "in" && !charged.has(row.id)).length,
      },
      unlinkedCount: links.filter((link) => link.status !== "linked").length,
    },
  };
}
