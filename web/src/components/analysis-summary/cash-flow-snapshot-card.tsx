import Link from "next/link";
import { Icon } from "@/components/icon";
import { snapshot } from "@/content/analysis-summary";
import type { AnalyticsResult } from "@/lib/api";
import { formatKes } from "@/lib/format";

function MetricTile({
  label,
  amount,
  detail,
  amountTone,
}: {
  label: string;
  amount: string;
  detail: string;
  amountTone: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-surface-container-low flex flex-col gap-0.5">
      <span className="text-[11px] font-label uppercase text-on-surface-variant tracking-wider">
        {label}
      </span>
      <span className={`text-base font-label font-semibold tabular-nums ${amountTone}`}>
        {amount}
      </span>
      <span className="text-[10px] font-body text-on-surface-variant">{detail}</span>
    </div>
  );
}

export function CashFlowSnapshotCard({
  period,
  itemCount,
  cashFlow,
  overviewHref,
}: {
  period: string;
  itemCount: string;
  cashFlow: AnalyticsResult["cash_flow"];
  overviewHref: string;
}) {
  return (
    <div className="rounded-xl bg-surface-container-lowest border border-hairline shadow-sm p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Icon name="verified" size={18} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-label font-medium text-on-surface">
              {snapshot.runLabel}
            </span>
            <span className="text-[11px] font-body text-on-surface-variant">{period}</span>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-xs bg-surface-container text-[11px] font-label text-on-surface-variant tabular-nums">
          {itemCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <MetricTile
          {...snapshot.inflow}
          amount={formatKes(cashFlow.total_inflow, { signed: true })}
          amountTone="text-primary"
        />
        <MetricTile
          {...snapshot.outflow}
          amount={formatKes(-cashFlow.total_outflow)}
          amountTone="text-on-surface"
        />
      </div>

      <div className="p-4 rounded-lg bg-primary-fixed/30 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[11px] font-label font-semibold text-on-primary-fixed-variant uppercase tracking-wider">
            {snapshot.net.label}
          </span>
          <span className="text-xs font-body text-on-surface-variant">{snapshot.net.detail}</span>
        </div>
        <div className="text-right">
          <span className="text-xl font-label font-bold text-primary tabular-nums">
            {formatKes(cashFlow.net_cash_flow, { signed: true })}
          </span>
        </div>
      </div>

      <Link
        href={overviewHref}
        className="w-full h-12 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-headline font-semibold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition-all"
      >
        <span>{snapshot.ctaLabel}</span>
        <Icon name="arrow_forward" size={18} />
      </Link>
    </div>
  );
}
