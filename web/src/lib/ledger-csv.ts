// The Ledger's CSV export (IA migration Stage 5, decision Q-P4): the rows of
// the current scope, one line per statement row, so charges are lines of
// their own and the money columns add up to the scope's totals. Identifier,
// statement-line and channel columns are not exported (Q-P3, M-32).

import { BUCKET_LABELS } from "@/content/ledger";
import { toCents, type StatementRow } from "@/lib/statement/rows";

export const LEDGER_CSV_HEADER = [
  "receipt_no",
  "date",
  "time",
  "entity",
  "counts_as",
  "event_type",
  "money_in_kes",
  "money_out_kes",
  "balance_kes",
  "statement_details",
];

/** A cents amount as a plain 2-decimal KES figure, e.g. 200000 → "2000.00". */
function kesCell(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * One CSV line per member row of a scope, in the order given: the receipt,
 * the statement's date and time (an unreadable time keeps its raw text in the
 * date column), what the row counts as (DR-3), its event type, money in or
 * out, the balance after it and the statement text.
 */
export function ledgerCsvRows(members: StatementRow[]): string[][] {
  return members.map((row) => [
    row.receiptNo,
    row.completedAt?.date ?? row.source.completion_time,
    row.completedAt?.time ?? "",
    row.entity,
    BUCKET_LABELS[row.bucket],
    row.eventType,
    row.direction === "in" ? kesCell(row.principalCents) : "",
    row.direction === "out" ? kesCell(row.principalCents) : "",
    kesCell(toCents(row.source.balance)),
    row.source.details,
  ]);
}
