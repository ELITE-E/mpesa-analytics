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

/**
 * The export's file name: the statement period's dates and nothing else, so no name, number,
 * receipt or scope (which may name a person) ends up in a downloads folder or a file listing.
 *
 * @param summary The statement's period, as printed completion times.
 * @returns e.g. "mpesa-ledger-2026-01-02-to-2026-01-31.csv", or "mpesa-ledger.csv" without dates.
 */
export function ledgerCsvFileName(summary: { period_start: string; period_end: string }) {
  const date = (time: string) => (/^\d{4}-\d{2}-\d{2}/.exec(time) ?? [""])[0];
  const [start, end] = [date(summary.period_start), date(summary.period_end)];
  return start && end ? `mpesa-ledger-${start}-to-${end}.csv` : "mpesa-ledger.csv";
}
