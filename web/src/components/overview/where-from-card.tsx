import Link from "next/link";
import { StatList } from "@/components/analysis/stat-list";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS } from "@/content/breakdown";
import { BUCKET_LABELS } from "@/content/ledger";
import { SOURCE_TONE, unverified, whereFrom } from "@/content/overview";
import { formatKes, formatShare } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { Breakdown } from "@/lib/statement/overview";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/**
 * The line for payments from businesses, which the engine doesn't classify
 * yet (M-07, M-26): T-PLANNED, labelled (Q-P1), with no figure and no door,
 * and not part of money in's sources.
 */
function PlannedBusinessLine() {
  return (
    <div data-planned="" className="flex flex-col gap-space-2xs rounded-lg px-space-xs py-space-xs bg-surface-container-low/60">
      <div className="flex items-center justify-between gap-space-sm">
        <span className="font-body-md text-body-md font-semibold text-on-surface-variant">{whereFrom.business}</span>
        <span className="inline-flex items-center px-1.5 py-px rounded-xs bg-surface-container-highest text-on-surface-variant font-label-caps text-label-caps uppercase whitespace-nowrap">
          {whereFrom.planned}
        </span>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">{whereFrom.businessNote}</p>
    </div>
  );
}

/**
 * The inflow side of the story (DR-6): money in by source, each with its
 * DR-7 share and a door to its Ledger scope; the header is the API's money
 * in. Sources are withheld when the rows' inflow disagrees with the API's
 * (U-1, T-UNVERIFIED). Payments from businesses are a planned line. The
 * exit opens the Money In area on the import (Stage 7f).
 */
export function WhereFromCard({ sources, moneyInCents, importId }: { sources: Breakdown; moneyInCents: number; importId: number | null }) {
  const moneyIn = BREAKDOWN_AREAS.find((entry) => entry.id === "money-in")?.destination;
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm flex flex-col gap-space-sm">
      <div className="flex items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{whereFrom.title}</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{whereFrom.subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="font-label-caps text-label-caps text-on-surface-variant block uppercase">{whereFrom.totalLabel}</span>
          <span className="font-label-numeric-md text-label-numeric-md text-primary font-semibold tabular-nums">{kes(moneyInCents)}</span>
        </div>
      </div>
      {sources.status === "unverified" ? (
        <p data-unverified="" className="p-space-sm rounded-lg bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">
          {unverified}
        </p>
      ) : sources.items.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{whereFrom.empty}</p>
      ) : (
        <StatList
          items={sources.items.map((item) => ({
            label: BUCKET_LABELS[item.bucket],
            amount: kes(item.cents),
            share: formatShare(item.share),
            width: item.share ?? 0,
            barTone: SOURCE_TONE[item.bucket],
            href: ledgerHref({ scopeId: item.scopeId, from: "overview", importId }),
            kind: "evidence",
          }))}
        />
      )}
      <PlannedBusinessLine />
      {moneyIn && (
        <Link
          href={withImport(moneyIn.href, importId)}
          className="min-h-11 px-space-md rounded-lg bg-surface-container-low flex items-center justify-between font-body-sm text-body-sm font-semibold text-primary hover:bg-surface-container transition-colors"
        >
          {whereFrom.why}
          <Icon name="chevron_right" size={16} />
        </Link>
      )}
    </section>
  );
}
