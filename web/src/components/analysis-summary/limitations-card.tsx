"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/icon";
import { limitations, UNMAPPED_FILTER } from "@/content/analysis-summary";
import type { Transaction } from "@/lib/api";
import { formatCount, formatKes } from "@/lib/format";
import { withImport } from "@/lib/import-link";

// The transactions the engine could not classify, from the stored ledger.
// Shown only when there are some.
export function LimitationsCard({
  importId,
  transactionCount,
  unclassified,
}: {
  importId: number;
  transactionCount: number;
  unclassified: Transaction[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const detailId = useId();

  return (
    <div className="rounded-xl bg-surface-container-lowest border border-hairline shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-pill bg-tertiary-fixed text-on-tertiary-fixed font-label text-[11px] font-semibold flex items-center gap-1.5">
            <Icon name="warning" size={14} />
            {limitations.badge}
          </span>
        </div>
        <span className="text-xs font-label font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-xs tabular-nums">
          {formatCount(unclassified.length, "unclassified", "unclassified")}
        </span>
      </div>

      <p className="text-xs font-body text-on-surface-variant leading-relaxed">
        <strong className="text-on-surface font-semibold">
          {unclassified.length} of {formatCount(transactionCount, "transaction row")}
        </strong>
        {limitations.summaryMiddle}
        <span className="font-label text-[11px] bg-surface-container px-1.5 py-0.5 rounded-xs text-on-surface">
          {limitations.bucket}
        </span>
        .
      </p>

      <div className="rounded-lg bg-surface-container-low p-3 flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={detailId}
          onClick={() => setIsOpen((open) => !open)}
          className="flex items-center justify-between w-full text-left text-xs font-headline font-semibold text-on-surface"
        >
          <span className="flex items-center gap-1.5">
            <Icon name="tune" size={16} className="text-tertiary" />
            {limitations.scopeLabel}
          </span>
          <Icon
            name="expand_more"
            size={18}
            className={`text-on-surface-variant transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {isOpen && (
          <div id={detailId} className="flex flex-col gap-2.5 pt-2">
            <div className="text-[11px] font-body text-on-surface-variant bg-surface-container-lowest p-2.5 rounded-xs">
              <p className="leading-relaxed">{limitations.exclusionNote}</p>
            </div>
            {unclassified.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between gap-2 text-[11px] font-label bg-surface-container-lowest p-2 rounded-xs"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon name="receipt_long" size={14} className="text-on-surface-variant shrink-0" />
                  <span className="text-on-surface shrink-0">{record.receipt_no}</span>
                  <span className="text-on-surface-variant truncate">{record.details}</span>
                </div>
                <span className="text-tertiary tabular-nums shrink-0">
                  {formatKes(record.cash_flow_direction === "INFLOW" ? record.paid_in : -record.paid_out, { signed: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
        <Link
          href={withImport(`/ledger?filter=${UNMAPPED_FILTER}`, importId)}
          className="w-full sm:w-1/2 h-10 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-headline font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-all"
        >
          <Icon name="edit_note" size={16} />
          <span>{limitations.reviewLabel}</span>
        </Link>
        <Link
          href={withImport("/overview", importId)}
          className="w-full sm:w-1/2 h-10 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-headline font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-all"
        >
          <Icon name="done_all" size={16} />
          <span>{limitations.proceedLabel}</span>
        </Link>
      </div>
    </div>
  );
}
