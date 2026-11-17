import { Icon } from "@/components/icon";

/** The statement period and a short badge, e.g. the transaction count. */
export function PeriodRibbon({ range, badge }: { range: string; badge: string }) {
  return (
    <section className="flex items-center justify-between bg-surface-container-low rounded-xl px-space-base py-space-sm border border-hairline shadow-sm">
      <div className="flex items-center gap-space-xs">
        <Icon name="calendar_month" size={18} className="text-primary" />
        <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface font-semibold tabular-nums">
          {range}
        </span>
      </div>
      <div className="flex items-center gap-space-2xs bg-primary-fixed text-on-primary-fixed rounded-pill px-space-sm py-space-2xs">
        <Icon name="verified" size={13} filled />
        <span className="font-label-caps text-label-caps tracking-wide">{badge}</span>
      </div>
    </section>
  );
}
