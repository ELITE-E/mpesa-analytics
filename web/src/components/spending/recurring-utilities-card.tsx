import Link from "next/link";
import { Icon } from "@/components/icon";
import { utilitiesSection } from "@/content/spending";
import { formatCount, formatDate } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { RecurringFigure } from "@/lib/statement/spending";

/** One recurring purchase or bill: name, kind, how often and when; a door to its merchant's spending rows. */
function RecurringRow({ item, importId }: { item: RecurringFigure; importId: number | null }) {
  return (
    <Link
      href={ledgerHref({ scopeId: item.scopeId, from: "spending", importId })}
      className="block p-space-sm bg-surface-container-low rounded-lg space-y-space-xs hover:bg-surface-container transition-colors"
    >
      <div className="flex items-start justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0">
            <Icon name={item.kind === "bill" ? "receipt" : "shopping_bag"} size={20} />
          </div>
          <div className="min-w-0">
            <span className="font-body-md text-body-md font-semibold text-on-surface block truncate">{item.name}</span>
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              {item.kind === "bill" ? utilitiesSection.bill : utilitiesSection.purchase}
            </span>
          </div>
        </div>
        <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface tabular-nums shrink-0">{formatCount(item.occurrences, "payment")}</span>
      </div>
      <div className="flex items-center justify-between gap-space-sm text-on-surface-variant font-body-sm text-body-sm pt-space-2xs border-t border-surface-container-high">
        <span className="flex items-center gap-1 min-w-0">
          <Icon name="calendar_month" size={14} className="shrink-0" />
          <span className="truncate">{item.dates.map(formatDate).join(", ")}</span>
        </span>
        <span className="font-label-caps text-label-caps shrink-0">{utilitiesSection.seeRows}</span>
      </div>
    </Link>
  );
}

/**
 * Recurring payments as the API found them at import (M-13: recurring
 * purchases, then recurring bills). Their amounts are total-cost based, so
 * they're not shown (Q-D1); each row opens its merchant's spending rows. A
 * T-PARTIAL card: it always says what the rule needs, and says plainly when
 * it found nothing.
 */
export function RecurringUtilitiesCard({ recurring, importId }: { recurring: RecurringFigure[]; importId: number | null }) {
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm space-y-space-md min-w-0">
      <div>
        <div className="flex items-center gap-space-xs">
          <Icon name="event_repeat" size={18} className="text-primary" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{utilitiesSection.title}</h2>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{utilitiesSection.subtitle}</p>
      </div>
      {recurring.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface">{utilitiesSection.none}</p>
      ) : (
        <div className="space-y-space-sm">
          {recurring.map((item) => (
            <RecurringRow key={`${item.kind}:${item.name}`} item={item} importId={importId} />
          ))}
        </div>
      )}
      <p data-partial="" className="flex items-start gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
        <Icon name="info" size={16} className="text-primary mt-0.5 shrink-0" />
        {utilitiesSection.partial}
      </p>
    </section>
  );
}
