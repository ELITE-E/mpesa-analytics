import Link from "next/link";
import { Icon } from "@/components/icon";
import { ledger } from "@/content/ledger";
import { formatKes } from "@/lib/format";
import { ledgerHref, LEDGER_ORIGINS, originHref, type LedgerOrigin } from "@/lib/ledger-link";

/** A scope's own totals in cents (its rows only): count, money in, money out (non-fee) and charges. */
export type ScopeTotals = { count: number; inCents: number; outCents: number; chargeCents: number };

type ScopeBannerProps = {
  title: string;
  question: string;
  totals: ScopeTotals;
  /** The scope's DR-10 figure; null for a scope measured "both". */
  figureCents: number | null;
  /** A receipt is described by its detail card instead of totals. */
  isReceipt: boolean;
  origin: LedgerOrigin | null;
  importId: number | null;
};

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The sentence under a scope's totals: its figure, both directions, or a real zero. */
function figureSentence(totals: ScopeTotals, figureCents: number | null) {
  if (totals.count === 0) return ledger.noRows;
  if (figureCents === null) return `These ${totals.count} rows are every movement in this group, both directions.`;
  return `These ${totals.count} ${totals.count === 1 ? "row adds" : "rows add"} up to ${kes(figureCents)}.`;
}

/**
 * IA prototype: says which rows the Ledger shows and what they add up to. The
 * totals are the scope's own rows only (DR-10, I-4), never the statement's.
 * A back link appears when the visit came from a known screen (?from), and
 * "Show all rows" keeps the origin and the import.
 */
export function ScopeBanner({ title, question, totals, figureCents, isReceipt, origin, importId }: ScopeBannerProps) {
  return (
    <section className="bg-surface-container-lowest rounded-xl border border-hairline border-l-4 border-l-primary shadow-sm p-space-base flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-xs">
        {origin ? (
          <Link
            href={originHref(origin, importId)}
            className="inline-flex items-center gap-space-2xs min-h-9 font-body-sm text-body-sm font-semibold text-primary hover:underline"
          >
            <Icon name="arrow_back" size={16} />
            Back to {LEDGER_ORIGINS[origin].label}
          </Link>
        ) : (
          <span />
        )}
        <Link
          href={ledgerHref({ scopeId: null, from: origin, importId })}
          className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-primary hover:underline"
        >
          {ledger.showAll}
        </Link>
      </div>

      <div className="flex flex-col gap-space-2xs">
        <h2 data-scope-title="" className="font-headline text-xl lg:text-2xl font-bold tracking-tight text-on-surface">
          {title}
        </h2>
        <p className="font-body-sm text-body-sm text-on-surface-variant">&ldquo;{question}&rdquo;</p>
      </div>

      {!isReceipt && (
        <div data-scope-totals="" className="flex flex-col gap-space-xs bg-surface-container-low rounded-lg p-space-sm">
          <div className="flex flex-wrap items-baseline gap-x-space-base gap-y-space-2xs font-label-numeric-sm text-label-numeric-sm tabular-nums">
            <span className="text-on-surface font-semibold">
              {totals.count} {totals.count === 1 ? "row" : "rows"}
            </span>
            {totals.inCents > 0 && <span className="text-primary">In {kes(totals.inCents)}</span>}
            {totals.outCents > 0 && <span className="text-on-surface">Out {kes(totals.outCents)}</span>}
            {totals.chargeCents > 0 && <span className="text-tertiary">Charges {kes(totals.chargeCents)}</span>}
          </div>
          <p className="flex items-start gap-space-xs font-body-sm text-body-sm text-on-surface">
            <Icon name={totals.count > 0 ? "check_circle" : "info"} size={16} className="text-primary mt-0.5 shrink-0" filled />
            {figureSentence(totals, figureCents)}
          </p>
        </div>
      )}
    </section>
  );
}
