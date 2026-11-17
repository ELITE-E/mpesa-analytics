import { AnalysisSummaryView } from "@/components/analysis-summary/analysis-summary-view";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { PageShell } from "@/components/layout/page-shell";

/**
 * Stitch screen: "Analysis Complete & Limitations" (2e98afcf03074fed85214bd05c0bd2c2),
 * for `?import=<id>` or the latest import. The last ingestion step: it stays a
 * centred column at every width, inside the responsive ingest shell.
 */
export default function AnalysisSummaryPage() {
  // A static export cannot read the URL on the server. CP8b holds one session and shows its
  // latest statement; choosing another is CP9.
  const importId = null;
  return (
    <PageShell
      header={<AppHeader />}
      nav={<BottomNav active="ingest" />}
      desktop={{ tabs: "ingest", active: "ingest" }}
      mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col"
    >
      <div className="flex flex-col w-full px-4 py-6 lg:py-10 gap-6 max-w-xl mx-auto">
        <AnalysisSummaryView importId={importId} />
      </div>
    </PageShell>
  );
}
