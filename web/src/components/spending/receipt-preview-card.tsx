"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { receiptsSection } from "@/content/spending";
import { formatDateTime, formatKes } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { ReceiptPreviewSet } from "@/lib/statement/spending";

/**
 * The most recent spending receipts (M-14), all or for one of the top
 * merchants, chosen with pressed-state toggle buttons that wrap (a long
 * merchant name is truncated, whole in its title). Each receipt opens its
 * receipt in Ledger, and the call to action opens every spending row there
 * (the Ledger owns line-item detail).
 */
export function ReceiptPreviewCard({ receipts, importId }: { receipts: ReceiptPreviewSet; importId: number | null }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const visible = receipts.previews[activeFilter] ?? [];
  const total = receipts.filters[0]?.count ?? 0;

  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm space-y-space-base min-w-0">
      <div>
        <span className="font-label-caps text-label-caps text-primary uppercase font-bold tracking-wider">{receiptsSection.label}</span>
        <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{receiptsSection.title}</h2>
      </div>

      {receipts.filters.length > 1 && (
        <div className="flex flex-wrap items-center gap-space-xs" role="group" aria-label={receiptsSection.filterLabel}>
          {receipts.filters.map((filter) => {
            const isActive = filter.id === activeFilter;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveFilter(filter.id)}
                title={filter.label ?? undefined}
                className={`inline-flex max-w-full items-center px-space-sm py-1 rounded-lg font-label-caps text-label-caps uppercase whitespace-nowrap tabular-nums focus-visible:outline-2 focus-visible:outline-primary ${
                  isActive ? "bg-primary text-on-primary font-semibold" : "bg-surface-container text-on-surface-variant font-medium hover:bg-surface-container-high"
                }`}
              >
                <span className="truncate max-w-48">{filter.label ?? receiptsSection.allFilter}</span>
                <span className="shrink-0">&nbsp;({filter.count})</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-space-xs">
        {visible.map((receipt) => (
          <Link
            key={receipt.receiptNo}
            href={ledgerHref({ scopeId: receipt.scopeId, from: "spending", importId })}
            className="p-space-sm bg-surface-container-low rounded-lg flex items-center justify-between gap-space-sm hover:bg-surface-container transition-colors"
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-space-xs min-w-0">
                <span className="receipt-badge shrink-0">
                  {receipt.receiptNo}
                </span>
                <span className="font-body-md text-body-md font-semibold text-on-surface truncate">{receipt.label}</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant tabular-nums">{formatDateTime(receipt.time)}</p>
            </div>
            <div className="text-right shrink-0">
              <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface block tabular-nums">-{formatKes(receipt.cents / 100)}</span>
              <span className="font-label-caps text-label-caps text-primary font-medium tabular-nums">Bal {formatKes(receipt.balanceCents / 100)}</span>
            </div>
          </Link>
        ))}
        {visible.length === 0 && <p className="p-space-sm bg-surface-container-low rounded-lg font-body-sm text-body-sm text-on-surface-variant">{receiptsSection.emptyPreview}</p>}
      </div>

      {total > 0 && (
        <Link
          href={ledgerHref({ scopeId: "bucket:spending", from: "spending", importId })}
          className="w-full py-space-sm bg-primary text-on-primary rounded-lg flex items-center justify-center gap-space-xs hover:bg-primary-container transition-colors shadow-sm"
        >
          <span className="font-headline-sm text-headline-sm font-semibold">{receiptsSection.cta(total)}</span>
          <Icon name="arrow_forward" size={18} />
        </Link>
      )}
    </section>
  );
}
