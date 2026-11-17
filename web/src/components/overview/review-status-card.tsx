import Link from "next/link";
import { Icon } from "@/components/icon";
import { review as copy } from "@/content/overview";
import { formatCount, formatKes } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { OverviewFigures } from "@/lib/statement/overview";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** "KES 75,000.00 in and KES 12,100.00 out": the directions the unclassified rows moved, zero ones left out. */
function movedText(rows: NonNullable<OverviewFigures["review"]["rows"]>) {
  const parts = [rows.inCents > 0 ? `${kes(rows.inCents)} in` : null, rows.outCents > 0 ? `${kes(rows.outCents)} out` : null].filter(Boolean);
  return parts.join(" and ");
}

/**
 * IA prototype: review state on Overview. The count is the import's own
 * (`unclassified_transaction_count`, statement lines, Q-D5); the amounts per
 * direction come from the stored rows (H checks), with a door to their
 * Ledger scope. When the stored rows number differently from the import's
 * count (U-5, duplicates stored once) that is explained, never treated as an
 * error. With nothing unclassified the card says so and has no door to an
 * empty scope. Read-only: resolving a row needs the override endpoint.
 */
export function ReviewStatusCard({
  review,
  lineCount,
  importId,
}: {
  review: OverviewFigures["review"];
  lineCount: number;
  importId: number | null;
}) {
  const statementCheck = (
    <Link
      href={withImport("/analysis-summary", importId)}
      className="flex-1 min-h-11 px-space-md rounded-lg bg-surface-container-lowest hover:bg-surface-container-low flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold text-on-surface border border-hairline shadow-sm transition-colors"
    >
      <Icon name="fact_check" size={16} className="text-primary" />
      {copy.statementCheck}
    </Link>
  );

  if (review.apiCount === 0) {
    return (
      <section className="rounded-xl p-space-base bg-surface-container-lowest border border-hairline shadow-sm flex flex-col gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <Icon name="task_alt" size={18} className="text-primary" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{copy.doneTitle}</h2>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {copy.done} {formatCount(lineCount, "statement line")}.
        </p>
        <div className="flex">{statementCheck}</div>
      </section>
    );
  }

  const lines = formatCount(review.apiCount, "statement line");
  const rows = review.rows;
  return (
    <section className="rounded-xl p-space-base border border-error/30 bg-error-container/30 flex flex-col gap-space-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <Icon name="rule" size={18} className="text-error" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{copy.title}</h2>
        </div>
        <span className="font-label-caps text-label-caps uppercase text-on-error-container bg-error-container px-space-xs py-0.5 rounded-xs whitespace-nowrap">
          {lines}
        </span>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {copy.count(lines)}{" "}
        {rows && movedText(rows) && (
          <>
            {copy.amounts} <span className="font-semibold text-on-surface">{movedText(rows)}</span>.{" "}
          </>
        )}
        {copy.explanation}
        {review.countsAgree === false && rows && <> {copy.storedOnce(formatCount(rows.count, "line"))}</>}
      </p>
      <div className="flex flex-col sm:flex-row gap-space-xs">
        {rows && rows.count > 0 && (
          <Link
            href={ledgerHref({ scopeId: rows.scopeId, from: "overview", importId })}
            className="flex-1 min-h-11 px-space-md rounded-lg bg-surface-container-lowest hover:bg-surface-container-low flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold text-on-surface border border-hairline shadow-sm transition-colors"
          >
            <Icon name="receipt_long" size={16} className="text-primary" />
            {copy.seeRows(formatCount(rows.count, "row"))}
          </Link>
        )}
        {statementCheck}
      </div>
    </section>
  );
}
