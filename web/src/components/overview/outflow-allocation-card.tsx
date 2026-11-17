import Link from "next/link";
import { Icon } from "@/components/icon";
import { BUCKET_LABELS } from "@/content/ledger";
import { allocation, ALLOCATION_SWATCH, unverified } from "@/content/overview";
import { formatKes, formatShare } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { Breakdown, BreakdownItem } from "@/lib/statement/overview";
import { barWidthClass } from "@/lib/bar-width";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** One bucket: its colour, label, amount and share, a door to its Ledger scope. */
function AllocationRow({ item, href }: { item: BreakdownItem; href: string }) {
  const isFriction = item.bucket === "charges";
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-space-sm py-space-2xs px-space-xs rounded-lg transition-colors ${
        isFriction ? "bg-surface-container-low" : "hover:bg-surface-container-low"
      }`}
    >
      <div className="flex items-center gap-space-xs min-w-0">
        <span className={`w-2.5 h-2.5 rounded-pill shrink-0 ${ALLOCATION_SWATCH[item.bucket] ?? "bg-outline"}`} />
        <span className={`font-body-sm text-body-sm truncate ${isFriction ? "text-tertiary font-medium" : "text-on-surface"}`}>
          {BUCKET_LABELS[item.bucket]}
        </span>
      </div>
      <div className="flex items-center gap-space-sm shrink-0">
        <span className={`font-label-numeric-sm text-label-numeric-sm tabular-nums ${isFriction ? "text-tertiary font-semibold" : "text-on-surface"}`}>
          {kes(item.cents)}
        </span>
        <span className={`font-label-caps text-label-caps w-11 text-right tabular-nums ${isFriction ? "text-tertiary" : "text-on-surface-variant"}`}>
          {formatShare(item.share)}
        </span>
        <Icon name="receipt_long" size={16} className="text-primary/70" />
      </div>
    </Link>
  );
}

/**
 * Where the money went (DR-5): every outflow row in one DR-3 bucket, with
 * its DR-7 share of money out and a door to the bucket's Ledger scope, whose
 * rows add up to it. The header is the API's money out. When the rows'
 * outflow or charges disagree with the API's (U-2, U-3) the buckets are
 * withheld (T-UNVERIFIED) and only the API total stays.
 */
export function OutflowAllocationCard({
  allocation: breakdown,
  moneyOutCents,
  importId,
}: {
  allocation: Breakdown;
  moneyOutCents: number;
  importId: number | null;
}) {
  const items = breakdown.status === "shown" ? breakdown.items : [];
  const lastIndex = items.length - 1;
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm">
      <div className="flex items-start justify-between gap-space-sm mb-space-xs">
        <div className="min-w-0">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{allocation.title}</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{allocation.subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="font-label-caps text-label-caps text-on-surface-variant block uppercase">{allocation.totalLabel}</span>
          <span className="font-label-numeric-md text-label-numeric-md text-on-surface font-semibold tabular-nums">{kes(moneyOutCents)}</span>
        </div>
      </div>

      {breakdown.status === "unverified" ? (
        <p data-unverified="" className="mt-space-sm p-space-sm rounded-lg bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">
          {unverified}
        </p>
      ) : items.length === 0 ? (
        <p className="mt-space-sm font-body-sm text-body-sm text-on-surface-variant">{allocation.empty}</p>
      ) : (
        <>
          <div className="w-full h-3.5 bg-surface-container-highest rounded-pill overflow-hidden flex gap-[2px] mt-space-sm mb-space-md p-[2px]">
            {items.map((item, index) => (
              <div
                key={item.bucket}
                title={`${BUCKET_LABELS[item.bucket]}: ${formatShare(item.share)}`}
                className={`h-full ${barWidthClass(item.share)} ${ALLOCATION_SWATCH[item.bucket] ?? "bg-outline"} ${index === 0 ? "rounded-l-pill" : ""} ${index === lastIndex ? "rounded-r-pill" : ""}`}
              />
            ))}
          </div>
          <div className="space-y-space-xs">
            {items.map((item) => (
              <AllocationRow key={item.bucket} item={item} href={ledgerHref({ scopeId: item.scopeId, from: "overview", importId })} />
            ))}
          </div>
        </>
      )}

      {/* IA prototype: the named exit into the "Why?" level. */}
      <Link
        href={withImport("/breakdown", importId)}
        className="mt-space-md min-h-11 px-space-md rounded-lg bg-surface-container-low hover:bg-surface-container flex items-center justify-between font-body-sm text-body-sm font-semibold text-on-surface transition-colors"
      >
        {allocation.why}
        <Icon name="arrow_forward" size={18} className="text-primary" />
      </Link>
    </section>
  );
}
