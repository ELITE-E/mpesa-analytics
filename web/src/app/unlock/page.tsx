import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/layout/page-shell";
import { UnlockPanel } from "@/components/remember/unlock-panel";

/**
 * Unlock the statements saved on this device (CP9c item 2).
 */
export default function UnlockPage() {
  return (
    <PageShell header={<AppHeader />} desktop={{ tabs: "ingest" }} mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col">
      <div className="flex flex-col w-full px-4 py-6 lg:py-10 max-w-2xl mx-auto">
        <UnlockPanel />
      </div>
    </PageShell>
  );
}
