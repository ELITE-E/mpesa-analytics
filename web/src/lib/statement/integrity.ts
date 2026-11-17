// Hard integrity checks (DR-0, plan rev2 R2.1) that complete H-1..H-3, which
// getAllTransactions enforces while paging. A failure is confirmed against
// verified API contracts, so the rows are rejected as a failed load.

import { incompleteTransactionsError, type ImportSummary, type Transaction } from "@/lib/api";

/** H-5: a row's amounts are finite numbers and it never moves money both in and out. */
function isWellFormed(row: Transaction) {
  const finite = Number.isFinite(row.paid_in) && Number.isFinite(row.paid_out);
  return finite && !(row.paid_in > 0 && row.paid_out > 0);
}

/**
 * Throw the "incomplete_transactions" ApiError (as H-1..H-3 do) unless the
 * loaded rows are the import's: as many as its `transaction_count` (H-4,
 * both count the same stored rows) and each well formed (H-5). The screen
 * then shows its error card with Try again instead of partial figures.
 */
export function assertRowsIntact(rows: Transaction[], summary: ImportSummary) {
  if (rows.length !== summary.transaction_count || !rows.every(isWellFormed)) throw incompleteTransactionsError();
}
