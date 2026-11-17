// Opening balance (DR-4, plan rev1 §1.2; checked by rev2 U-4). Which value a
// screen shows, and how, is decided later (Q-D6); this module only computes
// both and says whether they agree.

import type { AnalyticsResult } from "@/lib/api";
import { toCents, type StatementRow } from "@/lib/statement/rows";

/** O2, or why it cannot be computed from the rows without guessing. */
export type RowOpeningBalance =
  | { status: "computed"; cents: number }
  | { status: "unavailable"; reason: "no-rows" | "invalid-time" | "tied-earliest-time" };

export type OpeningBalance = {
  /** O1, from API values only; null for an import without rows. */
  o1Cents: number | null;
  o2: RowOpeningBalance;
  /** O2 against O1 to the cent; "not-checked" when either is missing. */
  check: "agrees" | "mismatch" | "not-checked";
};

/**
 * O2: the balance before the earliest row, `balance − paid_in + paid_out` of
 * that row. Only when every row's time is valid and exactly one row holds the
 * earliest time; otherwise the rows don't say which came first.
 */
function rowOpeningBalance(rows: StatementRow[]): RowOpeningBalance {
  if (rows.length === 0) return { status: "unavailable", reason: "no-rows" };
  if (rows.some((row) => row.completedAt === null)) return { status: "unavailable", reason: "invalid-time" };
  const sortKey = (row: StatementRow) => `${row.completedAt?.date} ${row.completedAt?.time}`;
  const earliestKey = rows.map(sortKey).sort()[0];
  const earliest = rows.filter((row) => sortKey(row) === earliestKey);
  if (earliest.length > 1) return { status: "unavailable", reason: "tied-earliest-time" };
  const { balance, paid_in, paid_out } = earliest[0].source;
  return { status: "computed", cents: toCents(balance) - toCents(paid_in) + toCents(paid_out) };
}

/**
 * DR-4: the import's opening balance. O1 = closing balance − net cash flow,
 * from the API's `cash_flow` (order-independent); O2 from the earliest row
 * when unambiguous. A mismatch (O2 ≠ O1) is reported, never resolved here.
 * An import with no rows has no opening balance: the API's closing balance
 * for it is a 0.0 placeholder, not a stated balance.
 */
export function openingBalance(rows: StatementRow[], cashFlow: AnalyticsResult["cash_flow"]): OpeningBalance {
  const o2 = rowOpeningBalance(rows);
  if (rows.length === 0) return { o1Cents: null, o2, check: "not-checked" };
  const o1Cents = toCents(cashFlow.closing_balance) - (toCents(cashFlow.total_inflow) - toCents(cashFlow.total_outflow));
  if (o2.status !== "computed") return { o1Cents, o2, check: "not-checked" };
  return { o1Cents, o2, check: o2.cents === o1Cents ? "agrees" : "mismatch" };
}
