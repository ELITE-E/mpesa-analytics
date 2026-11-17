// Display formatting only: values arrive computed from the API and are never
// recalculated here (docs/ANALYTICS_RESULT_CONTRACT.md).

import { parseCompletionTime } from "@/lib/statement/rows";

const kes = new Intl.NumberFormat("en-KE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "KES 1,234.00"; with `signed`, "+KES …" / "-KES …". */
export function formatKes(amount: number, { signed = false } = {}) {
  const text = `KES ${kes.format(Math.abs(amount))}`;
  if (amount < 0) return `-${text}`;
  return signed && amount > 0 ? `+${text}` : text;
}

const dayFormat = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-08-04" → "4 Aug 2026". Dates are calendar dates, shown as-is. */
export function formatDate(isoDate: string | null | undefined) {
  if (!isoDate) return "—";
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : dayFormat.format(date);
}

/**
 * A transaction's `completion_time` as the statement states it:
 * "2026-07-04 10:00:00" or "2026-07-04T10:00:00" → "4 Jul 2026, 10:00", with
 * no timezone conversion (DR-1). A value that is not a valid time is shown as
 * its raw text; an absent one as "—".
 */
export function formatDateTime(completionTime: string | null | undefined) {
  if (!completionTime) return "—";
  const parsed = parseCompletionTime(completionTime);
  return parsed ? `${formatDate(parsed.date)}, ${parsed.time.slice(0, 5)}` : completionTime;
}

export function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** "2026-08" → "Aug 2026". */
export function formatMonth(month: string) {
  const date = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? month
    : new Intl.DateTimeFormat("en-KE", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("en-KE")} ${count === 1 ? singular : plural}`;
}

/** A DR-7 share as "12.3%", or "N/A" for a zero whole (never "0%"). */
export function formatShare(share: number | null) {
  return share === null ? "N/A" : `${share.toFixed(1)}%`;
}
