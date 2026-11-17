import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { PageShell } from "@/components/layout/page-shell";
import { CapabilityList } from "@/components/welcome/capability-list";
import { ReturningSessionCard } from "@/components/welcome/returning-session-card";
import { UploadCallToAction } from "@/components/welcome/upload-call-to-action";
import { WelcomeHero } from "@/components/welcome/welcome-hero";

/**
 * Stitch screen: "Welcome — M-Pesa Analytics". A linear flow screen: it stays
 * a centred column at every width, inside the responsive ingest shell.
 */
export default function WelcomePage() {
  return (
    <PageShell
      header={<AppHeader />}
      nav={<BottomNav active="ingest" />}
      desktop={{ tabs: "ingest", active: "ingest" }}
      mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col"
    >
      <div className="flex flex-col w-full px-4 py-6 lg:py-10 max-w-2xl mx-auto space-y-6">
        <WelcomeHero />
        <UploadCallToAction />
        <CapabilityList />
        <ReturningSessionCard />
      </div>
    </PageShell>
  );
}
