import Link from "next/link";
import { CountsAsPill, lineName } from "@/components/analysis/txn-row";
import { BUCKET_LABELS, ledger } from "@/content/ledger";
import { formatDateTime, formatKes } from "@/lib/format";
import { ledgerHref, type LedgerOrigin } from "@/lib/ledger-link";
import { NO_ENTITY } from "@/lib/statement/groups";
import type { LedgerLine } from "@/lib/statement/ledger-lines";

/** One labelled amount of the receipt's money section. */
function Line({ label, value, strong = false, tone = "text-on-surface" }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-space-sm">
      <dt className="font-body-sm text-body-sm text-on-surface-variant">{label}</dt>
      <dd className={`font-label-numeric-sm text-label-numeric-sm tabular-nums ${strong ? "font-bold" : ""} ${tone}`}>{value}</dd>
    </div>
  );
}

/** How a charge shown on its own line relates to the receipt's transactions (rev2 R1.2). */
function chargeDisclosure(line: LedgerLine) {
  const link = line.ownLink;
  if (!link) return null;
  if (link.status === "orphan") return ledger.orphanDetail;
  if (link.status === "ambiguous") return ledger.ambiguousDetail(link.candidateIds.length);
  return ledger.linkedElsewhere;
}

/**
 * IA prototype: the last level of evidence for one Ledger line. What it
 * counts as, its date as the statement states it, its principal and each
 * charge shown on it (never added together: the economic-cost estimate is
 * disabled, plan rev2 R1.3), the balance after it, the statement's own text,
 * how the engine classified it, and every row with the same entity. A charge
 * on its own line carries the R1.2 disclosure.
 */
export function ReceiptDetail({ line, origin, importId }: { line: LedgerLine; origin: LedgerOrigin | null; importId: number | null }) {
  const { row, foldedCharges } = line;
  const disclosure = chargeDisclosure(line);
  const showEntityLink = !row.isCharge && row.entity !== NO_ENTITY;

  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex flex-col gap-space-2xs">
        <div className="flex flex-wrap items-center gap-space-xs">
          <span className="receipt-badge">{row.receiptNo}</span>
          <CountsAsPill line={line} />
        </div>
        <h3 className="font-headline-sm text-headline-sm text-on-surface">{lineName(line)}</h3>
        <p className="font-body-sm text-body-sm text-on-surface-variant tabular-nums">{formatDateTime(row.source.completion_time)}</p>
      </div>

      <dl className="bg-surface-container-low rounded-xl p-space-sm flex flex-col gap-space-xs">
        {row.direction === "in" ? (
          <Line label="Received" value={`+${formatKes(row.source.paid_in)}`} strong tone="text-primary" />
        ) : row.isCharge ? (
          <Line label="Charge" value={formatKes(row.source.paid_out)} strong tone="text-tertiary" />
        ) : (
          <>
            <Line label="Principal" value={formatKes(row.source.paid_out)} strong />
            {foldedCharges.length === 0 ? (
              <Line label="Charge" value="None" tone="text-on-surface-variant" />
            ) : (
              foldedCharges.map((charge) => (
                <Line key={charge.id} label={`Charge (${charge.source.details})`} value={`+ ${formatKes(charge.source.paid_out)}`} tone="text-tertiary" />
              ))
            )}
          </>
        )}
        <Line label="Balance after" value={formatKes(row.source.balance)} tone="text-on-surface-variant" />
      </dl>

      {disclosure && <p className="font-body-sm text-body-sm text-on-surface">{disclosure}.</p>}

      <div className="flex flex-col gap-space-2xs">
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">Counts as</span>
        <p className="font-body-sm text-body-sm text-on-surface font-semibold">{BUCKET_LABELS[row.bucket]}</p>
      </div>

      <div className="flex flex-col gap-space-2xs">
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">Statement text</span>
        <code className="block font-label text-[12px] leading-5 bg-surface-container-low rounded-lg p-space-sm text-on-surface break-words">{row.source.details}</code>
        {foldedCharges.map((charge) => (
          <code key={charge.id} className="block font-label text-[12px] leading-5 bg-surface-container-low rounded-lg p-space-sm text-on-surface-variant break-words">
            {charge.source.details} — {formatKes(charge.source.paid_out)} (separate line, linked by receipt {row.receiptNo})
          </code>
        ))}
      </div>

      <div className="flex flex-col gap-space-2xs">
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">Classification today</span>
        <p className="font-label text-[12px] text-on-surface">
          {row.eventType} → {row.source.economic_meaning}
        </p>
      </div>

      {showEntityLink && (
        <Link
          href={ledgerHref({ scopeId: `entity:${row.entity}`, from: origin, importId })}
          className="min-h-11 px-space-md rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold transition-colors"
        >
          All rows with {row.entity}
        </Link>
      )}
    </div>
  );
}
