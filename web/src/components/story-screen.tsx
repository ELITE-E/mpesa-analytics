import type { ReactNode } from "react";
import { pageCanvas } from "@/components/layout/canvas";
import { PageShell } from "@/components/layout/page-shell";
import { StoryBottomNav, type StoryNavKey } from "@/components/story-bottom-nav";
import { StatementDataProvider } from "@/components/statement-data";
import { StoryHeader } from "@/components/story-header";

/**
 * Frame of the financial story screens, on the shared PageShell: the story
 * header and the three-level tab bar below 1024px, the desktop app bar with
 * the story levels and the footer from 1024px, all scoped to import
 * `importId` (null: the latest). `navKey` is the screen's level. The screen
 * title is the mobile header's heading; from 1024px, where that header is
 * hidden, it is shown at the top of the content column instead, so each
 * width has exactly one visible h1. The import is loaded once for the whole
 * page (StatementDataProvider), its transactions too when `loadTransactions`
 * is set, and shared by the shell and the body. The content sits in a
 * narrow reading column, or, with `wide`, on the full page canvas (the
 * Ledger's analytical grid, as in the IA prototype).
 */
export function StoryScreen({
  title,
  navKey,
  importId,
  loadTransactions = false,
  wide = false,
  children,
}: {
  title: string;
  navKey?: StoryNavKey;
  importId: number | null;
  loadTransactions?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <StatementDataProvider importId={importId} withTransactions={loadTransactions}>
      <PageShell
        header={<StoryHeader title={title} importId={importId} />}
        nav={<StoryBottomNav active={navKey} importId={importId} />}
        desktop={{ tabs: "story", active: navKey, importId }}
        mainClassName="flex-1 flex flex-col relative w-full pt-16 pb-24 bg-surface"
      >
        <div className={`flex flex-col py-space-base lg:py-10 gap-space-md ${wide ? pageCanvas : "w-full px-space-base max-w-2xl mx-auto"}`}>
          <h1 className="hidden lg:block font-headline text-2xl font-bold tracking-tight text-on-surface">
            {title}
          </h1>
          {children}
        </div>
      </PageShell>
    </StatementDataProvider>
  );
}
