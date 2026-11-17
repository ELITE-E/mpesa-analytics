import Link from "next/link";
import { PrivateOnDevice } from "@/components/private-on-device";
import { Icon } from "@/components/icon";
import { StoryPeriod } from "@/components/story-period";
import { withImport } from "@/lib/import-link";

/**
 * Fixed mobile and tablet app bar of the financial story screens: status
 * dot, screen title, the statement shown (StoryPeriod), then Statement check
 * (the import's analysis summary) and the account control. It is
 * `display: none` from 1024px, where the desktop app bar is shown instead.
 */
export function StoryHeader({ title, importId }: { title: string; importId: number | null }) {
  return (
    <header className="lg:hidden fixed top-0 w-full z-50 pt-safe bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-16 px-space-base md:px-6 flex items-center justify-between">
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-space-xs">
            <span className="w-2 h-2 rounded-pill bg-primary" />
            <h1 className="font-headline-sm text-headline-sm text-on-surface tracking-tight leading-none">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-space-xs mt-space-2xs">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
              <StoryPeriod />
            </span>
          </div>
        </div>
        <div className="flex items-center gap-space-sm">
          <Link
            href={withImport("/analysis-summary", importId)}
            aria-label="Statement check"
            className="w-11 h-11 flex items-center justify-center text-on-surface-variant rounded-pill hover:bg-surface-container transition-colors"
          >
            <Icon name="fact_check" size={20} />
          </Link>
          <PrivateOnDevice />
        </div>
      </div>
    </header>
  );
}
