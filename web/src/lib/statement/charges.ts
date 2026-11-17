// Charge linkage (DR-2, plan rev2 R1.2): which transaction a `FEE` row was
// charged for, as far as the API rows can tell. For display and attribution
// only: linking never changes a row, a principal or a bucket (Q-PRIN, Q-CHG).

import { toCents, type StatementRow } from "@/lib/statement/rows";

/**
 * How a `FEE` row relates to the import's other rows: linked to the one
 * non-fee row on its receipt, an orphan (no such row), or ambiguous (several,
 * listed). The engine's own attribution uses an extraction order the API does
 * not expose, so an ambiguous fee is never assigned to one of them.
 */
export type ChargeLink =
  | { feeId: number; status: "linked"; parentId: number }
  | { feeId: number; status: "orphan" }
  | { feeId: number; status: "ambiguous"; candidateIds: number[] };

/** What a `FEE` row charged: its `paid_out`, in cents (Q-CHG). */
function chargeCents(fee: StatementRow) {
  return toCents(fee.source.paid_out);
}

/** The ids of the non-fee rows on each receipt, in row order. */
function nonFeeRowsByReceipt(rows: StatementRow[]) {
  const byReceipt = new Map<string, number[]>();
  for (const row of rows) {
    if (row.isCharge) continue;
    byReceipt.set(row.receiptNo, [...(byReceipt.get(row.receiptNo) ?? []), row.id]);
  }
  return byReceipt;
}

/** DR-2: the link of every `FEE` row of `rows`, in row order. */
export function linkCharges(rows: StatementRow[]): ChargeLink[] {
  const candidatesByReceipt = nonFeeRowsByReceipt(rows);
  return rows
    .filter((row) => row.isCharge)
    .map((fee): ChargeLink => {
      const candidates = candidatesByReceipt.get(fee.receiptNo) ?? [];
      if (candidates.length === 1) return { feeId: fee.id, status: "linked", parentId: candidates[0] };
      if (candidates.length === 0) return { feeId: fee.id, status: "orphan" };
      return { feeId: fee.id, status: "ambiguous", candidateIds: candidates };
    });
}

/**
 * The charges of `rows` split by linkage (I-3): the total (Σ `paid_out` of
 * `FEE` rows, which equals the API's `total_fees`), the linked part, and the
 * orphan and ambiguous parts that must be disclosed as not linked to a single
 * transaction.
 */
export function summarizeCharges(rows: StatementRow[], links: ChargeLink[]) {
  const feeById = new Map(rows.filter((row) => row.isCharge).map((row) => [row.id, row]));
  const summary = { totalCents: 0, linkedCents: 0, orphanCents: 0, ambiguousCents: 0, unlinkedCount: 0 };
  for (const link of links) {
    const cents = chargeCents(feeById.get(link.feeId) as StatementRow);
    summary.totalCents += cents;
    if (link.status === "linked") summary.linkedCents += cents;
    else {
      summary.unlinkedCount += 1;
      if (link.status === "orphan") summary.orphanCents += cents;
      else summary.ambiguousCents += cents;
    }
  }
  return summary;
}

/** The linked charges of each parent row, in cents, in the order fees appear (Q-LINK, display only). */
export function linkedChargesByParent(rows: StatementRow[], links: ChargeLink[]) {
  const feeById = new Map(rows.filter((row) => row.isCharge).map((row) => [row.id, row]));
  const byParent = new Map<number, number>();
  for (const link of links) {
    if (link.status !== "linked") continue;
    const cents = chargeCents(feeById.get(link.feeId) as StatementRow);
    byParent.set(link.parentId, (byParent.get(link.parentId) ?? 0) + cents);
  }
  return byParent;
}

/** The cause of a charge that isn't linked to one transaction (orphan or ambiguous). */
export const UNLINKED_CAUSE = "unlinked";

/**
 * Decision Q-D7 (Stage 7c): the cause of each `FEE` row of `rows`, by id:
 * the `event_type` of the transaction it was charged for (DR-2 linkage), or
 * UNLINKED_CAUSE for an orphan or ambiguous charge, which is never assigned
 * to a guessed transaction.
 */
export function chargeCauses(rows: StatementRow[]) {
  const eventTypeById = new Map(rows.map((row) => [row.id, row.eventType]));
  return new Map(
    linkCharges(rows).map((link) => [link.feeId, link.status === "linked" ? (eventTypeById.get(link.parentId) as string) : UNLINKED_CAUSE]),
  );
}
