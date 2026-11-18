import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/layout/page-shell";
import { MergePanel } from "@/components/remember/merge-panel";

/**
 * Save a statement read with remembering on (CP9c item 4): the counts before the write, then
 * save or don't save.
 */
export default function MergePage() {
  return (
    <PageShell header={<AppHeader />} desktop={{ tabs: "ingest" }} mainClassName="flex-1 w-full pt-16 pb-20 bg-surface flex flex-col">
      <div className="flex flex-col w-full px-4 py-6 lg:py-10 max-w-2xl mx-auto">
        <MergePanel />
      </div>
    </PageShell>
  );
}
