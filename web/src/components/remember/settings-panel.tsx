"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DeleteAllControl } from "@/components/remember/delete-all";
import { LedgerSwitcher } from "@/components/remember/ledger-switcher";
import { RememberCard } from "@/components/remember/remember-card";
import { StatementList } from "@/components/remember/statement-list";
import { deleteAll, settings as copy, unlock } from "@/content/remember";
import { listImports, type ImportSummary } from "@/lib/api";
import {
  rememberView,
  rememberedLedgers,
  removeStatement,
  subscribeRemember,
  switchLedger,
  type RememberView,
} from "@/lib/remember";
import type { LedgerListing } from "@/persistence/store";

type SettingsData = {
  ledgers: LedgerListing[];
  currentLedgerId: string | null;
  statements: ImportSummary[];
};

/**
 * The settings screen's sections (CP9c items 1, 3 and 5): the remember card; while unlocked the
 * ledger switcher and the ledger's statements; while on (locked or not) delete-all.
 *
 * @param props The controller's view, the ledgers, the statements and the handlers.
 * @returns The sections.
 */
export function SettingsSections({
  view,
  ledgers,
  currentLedgerId,
  statements,
  onSwitch,
  onRemove,
}: SettingsData & { view: RememberView; onSwitch: (ledgerId: string) => void; onRemove: (statementId: number) => void }) {
  return (
    <div className="flex flex-col gap-4" data-settings="">
      <h1 className="font-headline text-lg font-semibold text-on-surface">{copy.title}</h1>
      {view.notice === "deleted" && (
        <p className="rounded-lg bg-surface-container-low p-3 font-body text-xs text-on-surface" role="status" data-deleted-notice="">
          {deleteAll.done}
        </p>
      )}
      <RememberCard view={view} />
      {view.phase === "locked" && (
        <Link
          href="/unlock"
          className="self-start py-2 px-3 rounded-lg bg-primary text-on-primary font-headline text-xs font-semibold"
        >
          {unlock.unlockChip}
        </Link>
      )}
      {view.phase === "unlocked" && (
        <section className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm space-y-4">
          <LedgerSwitcher ledgers={ledgers} currentLedgerId={currentLedgerId} onSwitch={onSwitch} />
          <StatementList statements={statements} onRemove={onRemove} />
        </section>
      )}
      {(view.phase === "locked" || view.phase === "unlocked") && (
        <section className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm space-y-2" data-delete-all="">
          <h2 className="font-headline text-sm font-semibold text-on-surface">{deleteAll.title}</h2>
          <p className="font-body text-xs text-on-surface-variant">{deleteAll.body}</p>
          <DeleteAllControl label={deleteAll.action} />
        </section>
      )}
    </div>
  );
}

/**
 * The settings screen, following the controller and the ledger on screen.
 *
 * @returns The panel.
 */
export function SettingsPanel() {
  const view = useSyncExternalStore(subscribeRemember, rememberView, rememberView);
  const [data, setData] = useState<SettingsData>(NOTHING_SHOWN);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await settingsData();
      if (!cancelled) setData(next);
    };
    void load();
    const stop = subscribeRemember(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <SettingsSections
      view={view}
      {...data}
      onSwitch={(ledgerId) => void switchLedger(ledgerId)}
      onRemove={(statementId) => void removeStatement(statementId)}
    />
  );
}

const NOTHING_SHOWN: SettingsData = { ledgers: [], currentLedgerId: null, statements: [] };

/**
 * What the settings screen lists: the ledgers and the shown ledger's statements while unlocked,
 * nothing otherwise.
 *
 * @returns The data. Side effects: decrypts the saved ledgers while unlocked.
 */
async function settingsData(): Promise<SettingsData> {
  if (rememberView().phase !== "unlocked") return NOTHING_SHOWN;
  const [{ ledgers, currentLedgerId }, page] = await Promise.all([rememberedLedgers(), listImports()]);
  return { ledgers, currentLedgerId, statements: page.items };
}
