"use client";

import { settings as copy } from "@/content/remember";
import { formatDate } from "@/lib/format";
import type { LedgerListing } from "@/persistence/store";

/**
 * The ledger switcher (CP9c item 3, N-22): one ledger per M-Pesa account, the one on screen
 * marked, a button to show each other one.
 *
 * @param props.ledgers The saved ledgers.
 * @param props.currentLedgerId The ledger on screen, or null.
 * @param props.onSwitch Show this ledger.
 * @returns The list.
 */
export function LedgerSwitcher({
  ledgers,
  currentLedgerId,
  onSwitch,
}: {
  ledgers: LedgerListing[];
  currentLedgerId: string | null;
  onSwitch: (ledgerId: string) => void;
}) {
  return (
    <div className="space-y-2" data-ledger-switcher="">
      <p className="font-headline text-xs font-semibold text-on-surface">{copy.ledgersTitle}</p>
      <p className="font-body text-[11px] text-on-surface-variant">{copy.ledgersHelp}</p>
      <ul className="space-y-2">
        {ledgers.map((ledger) => (
          <li key={ledger.ledgerId} className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low p-3" data-ledger="">
            <span className="font-body text-xs text-on-surface">
              {copy.ledgerLabel(formatDate(ledger.period.start), formatDate(ledger.period.end), ledger.statementCount)}
            </span>
            {ledger.ledgerId === currentLedgerId ? (
              <span className="font-label text-[10px] uppercase tracking-wide text-primary">{copy.currentLedger}</span>
            ) : (
              <button
                type="button"
                onClick={() => onSwitch(ledger.ledgerId)}
                className="py-1.5 px-3 rounded-lg bg-surface-container text-on-surface font-headline text-xs font-medium"
              >
                {copy.switchLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
