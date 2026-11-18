import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { PageShell } from "@/components/layout/page-shell";
import { SettingsPanel } from "@/components/remember/settings-panel";

/**
 * Saved data (CP9c): "Remember on this device", the ledgers, the saved statements and delete-all.
 */
export default function SettingsPage() {
  return (
    <PageShell
      header={<AppHeader />}
      nav={<BottomNav active="ingest" />}
      desktop={{ tabs: "ingest" }}
      mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col"
    >
      <div className="flex flex-col w-full px-4 py-6 lg:py-10 max-w-2xl mx-auto">
        <SettingsPanel />
      </div>
    </PageShell>
  );
}
