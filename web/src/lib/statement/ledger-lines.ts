// Ledger display lines (IA migration Stage 5; plan DR-10, rev2 R1.2): how the
// rows of a scope are listed. Display only: every row stays a member of its
// scope, counted in its totals, whether it has a line of its own or not.

import type { ChargeLink } from "@/lib/statement/charges";
import type { StatementRow } from "@/lib/statement/rows";

/**
 * One line of the Ledger: a row, the linked charges shown on it, and, for a
 * charge listed on its own line, how it is linked (to a transaction outside
 * the scope, to none, or to several).
 */
export type LedgerLine = {
  row: StatementRow;
  foldedCharges: StatementRow[];
  ownLink: ChargeLink | null;
};

/**
 * The lines of `members` (a scope's rows, statement order): a charge linked
 * to a transaction (DR-2) is shown on that transaction's line when both are
 * members; every other charge, and every orphan or ambiguous one, is a line
 * of its own with its link. Lines keep the order of their rows.
 */
export function ledgerLines(members: StatementRow[], links: ChargeLink[]): LedgerLine[] {
  const memberIds = new Set(members.map((row) => row.id));
  const linkByFee = new Map(links.map((link) => [link.feeId, link]));
  const folded = new Map<number, StatementRow[]>();
  for (const row of members) {
    const link = linkByFee.get(row.id);
    if (link?.status === "linked" && memberIds.has(link.parentId)) {
      folded.set(link.parentId, [...(folded.get(link.parentId) ?? []), row]);
    }
  }
  const foldedIds = new Set([...folded.values()].flat().map((row) => row.id));
  return members
    .filter((row) => !foldedIds.has(row.id))
    .map((row) => ({
      row,
      foldedCharges: folded.get(row.id) ?? [],
      ownLink: row.isCharge ? linkByFee.get(row.id) ?? null : null,
    }));
}
