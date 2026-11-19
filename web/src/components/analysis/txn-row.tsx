import { Icon } from "@/components/icon";
import { BUCKET_LABELS, BUCKET_STYLE, ledger } from "@/content/ledger";
import { formatKes } from "@/lib/format";
import { NO_ENTITY } from "@/lib/statement/groups";
import type { LedgerLine } from "@/lib/statement/ledger-lines";
import { toCents } from "@/lib/statement/rows";

/** The sum of a line's linked charges, in cents. */
export function foldedChargeCents(line: LedgerLine) {
  return line.foldedCharges.reduce((total, charge) => total + toCents(charge.source.paid_out), 0);
}

/**
 * The name a line is shown under: the R1.2 label for a charge not linked to
 * one transaction, "Not identified" for the engine's no-entity marker, and
 * otherwise the stored entity.
 */
export function lineName(line: LedgerLine) {
  if (line.ownLink && line.ownLink.status !== "linked") return ledger.unlinkedLabel;
  return line.row.entity === NO_ENTITY ? ledger.notIdentified : line.row.entity;
}

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** A pill naming what the line's row counts as (its DR-3 bucket). */
export function CountsAsPill({ line }: { line: LedgerLine }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-xs font-label text-[10px] font-semibold whitespace-nowrap ${BUCKET_STYLE[line.row.bucket].tone}`}>
      {BUCKET_LABELS[line.row.bucket]}
    </span>
  );
}

/**
 * One Ledger line as a card (IA prototype mobile card): who or what, what it
 * counts as, its time and receipt, then its amount, the charge shown on it (or
 * the disclosure of an unlinked charge) and the balance after it. A button:
 * it opens the line's receipt via `onOpen`, which receives the button so
 * focus can return to it.
 */
export function TxnRow({ line, time, onOpen }: { line: LedgerLine; time: string; onOpen: (line: LedgerLine, opener: HTMLElement) => void }) {
  const { row } = line;
  const inflow = row.direction === "in";
  const charges = foldedChargeCents(line);
  return (
    <button
      type="button"
      data-receipt-opener=""
      data-line-key={row.id}
      onClick={(event) => onOpen(line, event.currentTarget)}
      className="w-full text-left bg-surface-container-lowest rounded-xl p-3 border border-hairline shadow-sm flex items-center justify-between gap-3 hover:bg-surface-container-low transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${BUCKET_STYLE[row.bucket].tone}`}>
          <Icon name={BUCKET_STYLE[row.bucket].icon} size={20} />
        </div>
        <div className="flex flex-col min-w-0 gap-0.5">
          <span className="font-headline text-sm font-semibold text-on-surface truncate">{lineName(line)}</span>
          <span className="flex items-center gap-1.5 min-w-0">
            <CountsAsPill line={line} />
            <span className="font-label text-[10px] text-on-surface-variant tabular-nums shrink-0">{time}</span>
          </span>
          <span className="font-label text-[10px] text-on-surface-variant truncate">{row.receiptNo}</span>
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 text-right gap-0.5">
        <span className={`font-label text-sm font-bold tabular-nums ${inflow ? "text-primary" : "text-on-surface"}`}>
          {inflow ? "+" : "-"}
          {kes(row.principalCents)}
        </span>
        {!row.isCharge && (
          <span className={`font-label text-[10px] tabular-nums ${charges > 0 ? "text-tertiary font-semibold" : "text-on-surface-variant"}`}>
            {charges > 0 ? `+ ${kes(charges)} charge` : "No charge"}
          </span>
        )}
        <span className="font-label text-[10px] text-on-surface-variant tabular-nums">Bal {formatKes(row.source.balance)}</span>
      </div>
    </button>
  );
}
