import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { PageShell } from "@/components/layout/page-shell";
import { UploadHero } from "@/components/upload/upload-hero";
import { UploadWorkspace } from "@/components/upload/upload-workspace";

/**
 * Stitch screen: "Upload M-Pesa Statement" (d1322374e89147f395cfc8d1c0dc0b01).
 * A linear flow screen: it stays a centred column at every width, inside the
 * responsive ingest shell.
 */
export default function UploadPage() {
  return (
    <PageShell
      header={<AppHeader />}
      nav={<BottomNav active="ingest" />}
      desktop={{ tabs: "ingest", active: "ingest" }}
      mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col"
    >
      <div className="flex flex-col w-full px-4 py-4 lg:py-10 max-w-2xl mx-auto space-y-4">
        <UploadHero />
        <UploadWorkspace />
      </div>
    </PageShell>
  );
}
