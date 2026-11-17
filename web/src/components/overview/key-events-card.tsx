import Link from "next/link";
import { Icon } from "@/components/icon";
import { events } from "@/content/overview";
import { formatCount, formatDateTime, formatKes } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { LargestEvent, OverviewFigures } from "@/lib/statement/overview";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** Icon, tile tone and tag of each kind of largest transaction. */
const KIND: Record<LargestEvent["kind"], { icon: string; tone: string; tag: string }> = {
  purchase: { icon: "shopping_bag", tone: "bg-surface-container-high text-on-surface-variant", tag: events.purchase },
  inflow: { icon: "call_received", tone: "bg-primary-container/20 text-primary", tag: events.inflow },
  send: { icon: "north_east", tone: "bg-secondary-container text-on-secondary-fixed-variant", tag: events.send },
};

/** One largest transaction, a door to its receipt in Ledger. */
function EventRow({ event, href }: { event: LargestEvent; href: string }) {
  const inflow = event.kind === "inflow";
  const kind = KIND[event.kind];
  const note = event.kind === "purchase" ? events.inclCharges : event.chargeCents > 0 ? events.charge(kes(event.chargeCents)) : events.noCharge;
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-space-sm py-space-sm px-space-sm rounded-xl bg-surface-container-low/60 hover:bg-surface-container-low transition-colors"
    >
      <div className="flex items-center gap-space-sm min-w-0">
        <div className={`w-8 h-8 rounded-pill flex items-center justify-center shrink-0 ${kind.tone}`}>
          <Icon name={kind.icon} size={18} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-space-xs min-w-0">
            <span className="font-body-sm text-body-sm text-on-surface font-semibold truncate">{event.entity}</span>
            <span className="receipt-badge shrink-0">
              {event.receiptNo}
            </span>
          </div>
          {/* Normal case and tracking, as the other areas' date lines: the larger type scale needs the width at 390px. */}
          <div data-event-meta="" className="flex flex-wrap items-center gap-x-space-xs text-on-surface-variant font-label-caps text-label-caps normal-case tracking-normal mt-0.5 tabular-nums">
            <span className="whitespace-nowrap">{formatDateTime(event.time)}</span>
            <span>•</span>
            <span className={`whitespace-nowrap ${inflow ? "text-primary font-medium" : ""}`}>{kind.tag}</span>
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <span className={`font-label-numeric-sm text-label-numeric-sm block tabular-nums ${inflow ? "text-primary font-bold" : "text-on-surface font-semibold"}`}>
          {inflow ? "+" : "-"}
          {kes(event.cents)}
        </span>
        <span className={event.chargeCents > 0 ? "charge-pill tabular-nums" : "font-label-caps text-label-caps tabular-nums normal-case text-on-surface-variant"}>{note}</span>
      </div>
    </Link>
  );
}

/**
 * Largest transactions (decision Q-D4, replacing the prototype's hand-picked
 * key events): the API's largest purchases (amounts incl. charges, as
 * calculated at import), then the rows' largest inflow and largest send by
 * principal with their linked charge; each opens its receipt in Ledger.
 * `largest.derived` is null when the rows aren't available (T-LOADFAIL):
 * only the API's purchases are listed then.
 */
export function KeyEventsCard({
  largest,
  lineCount,
  importId,
}: {
  largest: OverviewFigures["largest"];
  lineCount: number;
  importId: number | null;
}) {
  const shown = [...largest.purchases, ...(largest.derived ?? [])];
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-space-xs gap-y-space-2xs mb-space-sm">
        <div className="flex items-center gap-space-xs">
          <Icon name="history_edu" size={18} className="text-primary" />
          <h2 className="font-headline-sm text-headline-sm text-on-surface whitespace-nowrap">{events.title}</h2>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{events.hint}</span>
      </div>

      {shown.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{events.empty}</p>
      ) : (
        <div className="space-y-space-xs">
          {shown.map((event) => (
            <EventRow key={`${event.kind}:${event.receiptNo}`} event={event} href={ledgerHref({ scopeId: event.scopeId, from: "overview", importId })} />
          ))}
        </div>
      )}

      {/* IA prototype: one named exit to the evidence level. */}
      <div className="mt-space-md pt-space-xs flex items-center justify-between gap-space-sm">
        <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums">{formatCount(lineCount, "statement line")}</span>
        <Link
          href={ledgerHref({ scopeId: null, from: "overview", importId })}
          className="bg-primary text-on-primary font-body-sm text-body-sm px-space-base py-space-xs min-h-9 rounded-xl flex items-center gap-space-xs hover:bg-primary-container active:scale-[0.98] transition-all shadow-sm"
        >
          <Icon name="receipt_long" size={16} />
          <span>{events.open}</span>
        </Link>
      </div>
    </section>
  );
}
