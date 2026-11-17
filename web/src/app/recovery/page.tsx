import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { PageShell } from "@/components/layout/page-shell";
import { RecoveryHero } from "@/components/recovery/recovery-hero";
import { RecoveryStatusBar } from "@/components/recovery/recovery-status-bar";
import { RecoveryWorkspace } from "@/components/recovery/recovery-workspace";

/**
 * Stitch screen: "Statement Interrupted & Recovery" (373566a2329e458f8d69f370d8175aed).
 * A linear flow screen: it keeps Stitch's narrow centred column at every
 * width, inside the responsive ingest shell.
 */
export default function RecoveryPage() {
  return (
    <PageShell
      header={<AppHeader />}
      nav={<BottomNav active="ingest" />}
      desktop={{ tabs: "ingest", active: "ingest" }}
      mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col"
    >
      <div className="flex flex-col w-full px-4 py-3 lg:py-10 space-y-4 max-w-md mx-auto">
        <RecoveryStatusBar />
        <RecoveryHero />
        <RecoveryWorkspace />
      </div>
    </PageShell>
  );
}
