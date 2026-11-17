import Link from "next/link";
import { Icon } from "@/components/icon";
import { exploreNext } from "@/content/analysis-summary";
import { withImport } from "@/lib/import-link";

export function ExploreNextCard({ importId }: { importId: number }) {
  return (
    <div className="rounded-xl bg-surface-container p-5 flex flex-col items-center text-center gap-3">
      <div className="w-10 h-10 rounded-pill bg-surface-container-lowest border border-hairline shadow-sm flex items-center justify-center text-primary">
        <Icon name="explore" size={20} />
      </div>
      <div className="flex flex-col gap-1 max-w-sm">
        <h2 className="text-sm font-headline font-bold text-on-surface">{exploreNext.title}</h2>
        <p className="text-xs font-body text-on-surface-variant">{exploreNext.description}</p>
      </div>
      <div className="flex flex-col sm:flex-row w-full gap-2 pt-1">
        <Link
          href={withImport("/ledger", importId)}
          className="w-full sm:w-1/2 h-11 rounded-lg bg-surface-container-lowest hover:bg-surface-container-low text-on-surface font-headline font-semibold text-xs flex items-center justify-center gap-2 border border-hairline shadow-sm transition-all"
        >
          <Icon name="table_view" size={16} className="text-secondary" />
          <span>{exploreNext.inspectLabel}</span>
        </Link>
        <Link
          href={withImport("/overview", importId)}
          className="w-full sm:w-1/2 h-11 rounded-lg bg-primary text-on-primary hover:bg-primary-container font-headline font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
        >
          <Icon name="bar_chart" size={16} />
          <span>{exploreNext.overviewLabel}</span>
        </Link>
      </div>
    </div>
  );
}
