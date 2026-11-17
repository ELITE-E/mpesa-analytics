import Link from "next/link";
import { Icon } from "@/components/icon";
import { rankedSection } from "@/content/spending";
import { formatCount, formatKes, formatShare } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { MerchantFigure, SpendingBreakdown } from "@/lib/statement/spending";
import { barWidthClass } from "@/lib/bar-width";

type Merchants = Extract<SpendingBreakdown, { status: "shown" }>["merchants"];

/** Bar tones of the ranked rows, by rank (IA prototype). */
const BAR_TONES = ["bg-primary", "bg-secondary", "bg-primary/80", "bg-secondary/80", "bg-primary/60"];

/** One merchant: rank, name, principal and DR-7 share of Spending, a bar against the top merchant, its payment count; a door to its rows. */
function MerchantRow({ merchant, importId }: { merchant: MerchantFigure; importId: number | null }) {
  return (
    <Link
      href={ledgerHref({ scopeId: merchant.scopeId, from: "spending", importId })}
      className={`block space-y-space-xs rounded-lg -mx-space-xs px-space-xs hover:bg-surface-container-low transition-colors ${merchant.rank > 1 ? "pt-space-xs" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="font-label-caps text-label-caps text-on-surface-variant font-bold shrink-0">#{merchant.rank}</span>
          <span className="font-body-md text-body-md font-semibold text-on-surface truncate">{merchant.label}</span>
        </div>
        <div className="text-right shrink-0">
          <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface tabular-nums">{formatKes(merchant.cents / 100)}</span>
          <span className="font-label-caps text-label-caps text-on-surface-variant ml-1 font-medium tabular-nums">({formatShare(merchant.share)})</span>
        </div>
      </div>
      <div className="w-full h-2 bg-surface-container-high rounded-pill overflow-hidden">
        <div className={`h-full rounded-pill ${BAR_TONES[merchant.rank - 1] ?? "bg-primary/60"} ${barWidthClass(merchant.barShare)}`} />
      </div>
      <div className="flex items-center justify-between text-on-surface-variant">
        <span className="font-label-caps text-label-caps">{rankedSection.count(formatCount(merchant.count, "payment"))}</span>
        <Icon name="receipt_long" size={14} className="text-primary/70" />
      </div>
    </Link>
  );
}

/**
 * Where Spending went: the top merchants and billers of the Spending bucket
 * by principal (DR-8, Q-D1), each a door to its rows within Spending (a
 * "group" scope), whose total is its figure.
 */
export function RankedMerchantsCard({ merchants, importId }: { merchants: Merchants; importId: number | null }) {
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm space-y-space-md min-w-0">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-space-xs">
            <Icon name="bar_chart" size={18} className="text-primary" />
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{rankedSection.title}</h2>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{rankedSection.subtitle}</p>
        </div>
        <span className="font-label-caps text-label-caps font-semibold text-primary shrink-0">{rankedSection.sortLabel}</span>
      </div>
      {merchants.items.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{rankedSection.empty}</p>
      ) : (
        <div className="space-y-space-md">
          {merchants.items.map((merchant) => (
            <MerchantRow key={merchant.entity} merchant={merchant} importId={importId} />
          ))}
        </div>
      )}
    </section>
  );
}
