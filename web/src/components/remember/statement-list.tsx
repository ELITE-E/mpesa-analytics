"use client";

import { useState } from "react";
import { settings as copy } from "@/content/remember";
import type { ImportSummary } from "@/lib/api";
import { formatCount, formatPeriod } from "@/lib/format";

/**
 * The statements saved in the ledger on screen, each with Remove behind a confirmation (CP9c
 * item 5).
 *
 * @param props.statements The ledger's statements, newest first.
 * @param props.onRemove Remove this statement, once confirmed.
 * @returns The list.
 */
export function StatementList({ statements, onRemove }: { statements: ImportSummary[]; onRemove: (statementId: number) => void }) {
  const [confirming, setConfirming] = useState<number | null>(null);
  return (
    <div className="space-y-2" data-statement-list="">
      <p className="font-headline text-xs font-semibold text-on-surface">{copy.statementsTitle}</p>
      {statements.length === 0 && <p className="font-body text-xs text-on-surface-variant">{copy.noStatements}</p>}
      <ul className="space-y-2">
        {statements.map((statement) => (
          <li key={statement.id} className="rounded-lg bg-surface-container-low p-3 space-y-2" data-saved-statement={statement.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-headline text-xs font-semibold text-on-surface">
                  {formatPeriod(statement.period_start, statement.period_end)}
                </span>
                <span className="font-label text-[11px] text-on-surface-variant">{formatCount(statement.transaction_count, "transaction")}</span>
              </div>
              {confirming !== statement.id && (
                <button
                  type="button"
                  onClick={() => setConfirming(statement.id)}
                  className="py-1.5 px-3 rounded-lg bg-surface-container text-error font-headline text-xs font-medium"
                >
                  {copy.removeLabel}
                </button>
              )}
            </div>
            {confirming === statement.id && (
              <div className="space-y-2" role="alertdialog" aria-label={copy.removeLabel}>
                <p className="font-body text-xs text-on-surface">{copy.removeQuestion}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      onRemove(statement.id);
                    }}
                    className="py-1.5 px-3 rounded-lg bg-error text-on-error font-headline text-xs font-semibold"
                  >
                    {copy.removeConfirm}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="py-1.5 px-3 rounded-lg bg-surface-container text-on-surface font-headline text-xs font-medium"
                  >
                    {copy.removeKeep}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
