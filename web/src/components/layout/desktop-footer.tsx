import { canvasFrame } from "@/components/layout/canvas";
import { APP_NAME } from "@/content/brand";

/**
 * Desktop-only (≥1024px) footer: the app's name (content/brand.ts) and the copyright year, nothing
 * else. The affiliation disclaimer is on the Welcome screen and in the README. The year is the
 * build's, since every page is exported at build time.
 */
export function DesktopFooter() {
  return (
    <footer className="hidden lg:block w-full bg-surface-container-lowest border-t border-surface-container-high py-8">
      <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 ${canvasFrame}`}>
        <p className="flex items-center gap-2 text-xs font-label text-on-surface-variant whitespace-nowrap">
          <span>{APP_NAME}</span>
          <span aria-hidden="true">·</span>
          <span>
            © {new Date().getFullYear()} {APP_NAME}
          </span>
        </p>
      </div>
    </footer>
  );
}
