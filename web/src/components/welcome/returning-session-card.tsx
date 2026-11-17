"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { returningSession } from "@/content/welcome";
import { listImports, type ImportSummary } from "@/lib/api";
import { formatCount, formatPeriod } from "@/lib/format";

// Offers the latest statement read in this session. Shown only when there is one;
// a reload forgets it, because nothing is stored (CP8b).
export function ReturningSessionCard() {
  const [latest, setLatest] = useState<ImportSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    listImports(1).then(
      (page) => {
        if (!cancelled) setLatest(page.items[0] ?? null);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="history" size={18} className="text-primary" />
          <span className="font-headline text-xs font-semibold text-on-surface uppercase tracking-wide">
            {returningSession.title}
          </span>
        </div>
        <span className="font-label text-[10px] text-on-surface-variant">
          {returningSession.badge}
        </span>
      </div>

      <div className="rounded-lg bg-surface-container-low p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-headline text-xs font-semibold text-on-surface">
            {formatPeriod(latest.period_start, latest.period_end)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] font-label text-on-surface-variant">
          <span>{formatCount(latest.transaction_count, "transaction")}</span>
          <span className="text-outline">Import #{latest.id}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Link
          href={`/analysis-summary?import=${latest.id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold shadow-sm hover:bg-primary-container transition-colors"
        >
          <span>{returningSession.resumeLabel}</span>
          <Icon name="arrow_forward" size={16} />
        </Link>
        <Link
          href="/upload"
          className="inline-flex items-center justify-center py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-headline text-xs font-medium transition-colors"
        >
          {returningSession.newPeriodLabel}
        </Link>
      </div>
    </div>
  );
}
