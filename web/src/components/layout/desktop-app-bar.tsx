import Link from "next/link";
import { PrivateOnDevice } from "@/components/private-on-device";
import { RememberHeaderControls } from "@/components/remember/lock-control";
import { INGEST_NAV_ITEMS, type NavKey } from "@/components/bottom-nav";
import { Icon } from "@/components/icon";
import { BrandMark } from "@/components/brand-mark";
import { canvasFrame } from "@/components/layout/canvas";
import { APP_NAME } from "@/content/brand";
import { StoryPeriod } from "@/components/story-period";
import { STORY_NAV_ITEMS, type StoryNavKey } from "@/components/story-bottom-nav";
import { withImport } from "@/lib/import-link";

/**
 * Which tabs the desktop app bar shows: the ingest screens' tabs, or the
 * story screens' three levels for import `importId` (null: the latest).
 * `active` is the current tab, omitted on screens that are not one.
 */
export type DesktopNavigation =
  | { tabs: "ingest"; active?: NavKey }
  | { tabs: "story"; active?: StoryNavKey; importId: number | null };

type Tab = { key: string; label: string; href: string };

/** What the story screens' statement is (migration decision C-15): its format only. */
const STATEMENT_FORMAT_LABEL = "M-PESA statement";

const OUTLINE_BUTTON =
  "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-xs font-medium text-on-surface bg-surface-container-lowest border border-outline-variant hover:bg-surface-container-low transition-colors";

/** The tabs for `navigation`, story levels scoped to its import with withImport. */
function desktopTabs(navigation: DesktopNavigation): Tab[] {
  if (navigation.tabs === "ingest") return INGEST_NAV_ITEMS;
  return STORY_NAV_ITEMS.map(({ key, label, href }) => ({ key, label, href: withImport(href, navigation.importId) }));
}

/**
 * Desktop (≥1024px) app bar from the IA prototype's "Overview — Desktop
 * Financial Story" bar: brand linking home, the tabs of `navigation`, and the
 * "Private on this device" label (there is no account, CP8b). On story screens it also names the statement shown
 * (its period from StoryPeriod and its format, "M-PESA statement") and links
 * to its Statement check. It is `display: none` below 1024px, where the mobile
 * header and tab bar are used instead, so exactly one copy of each control is
 * visible and in the accessibility tree at any width.
 *
 * The story bar holds more than the ingest bar, so it makes room for the
 * statement from 1024px by compacting the brand (and nothing else the plan
 * requires): logo only below 1280px, logo and name below 1440px, the full
 * brand from 1440px; the brand keeps its accessible name throughout. Below
 * 1440px its tabs also take less padding, so even the longest period
 * ("30 Sept 2024 – 29 Sept 2025") fits at 1024 and 1280px with room to spare.
 */
export function DesktopAppBar({ navigation }: { navigation: DesktopNavigation }) {
  const isStory = navigation.tabs === "story";

  return (
    <header className="hidden lg:block fixed top-0 left-0 w-full z-50 bg-surface/90 backdrop-blur-md border-b border-surface-container-high">
      <div className={`h-16 flex items-center justify-between gap-4 ${canvasFrame}`}>
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 whitespace-nowrap">
            <div className="w-8 h-8 rounded-xs bg-primary flex items-center justify-center">
              <BrandMark size={18} className="text-on-primary" />
            </div>
            {isStory && <span className="sr-only xl:hidden">{APP_NAME}</span>}
            <span className={`font-headline font-bold text-sm tracking-tight text-on-surface ${isStory ? "hidden xl:inline" : ""}`}>
              {APP_NAME}
            </span>
          </Link>
          {isStory && (
            <div className="flex items-center gap-2 px-2.5 py-1 bg-surface-container rounded-xs border border-surface-container-highest whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-pill bg-primary" />
              <span className="font-label text-[11px] text-on-surface font-semibold">
                <StoryPeriod />
              </span>
              <span className="text-[11px] text-on-surface-variant">•</span>
              {/* C-15: the statement's format, not a claim that it was verified. */}
              <span className="font-label text-[10px] text-on-surface-variant tracking-tight">{STATEMENT_FORMAT_LABEL}</span>
            </div>
          )}
        </div>

        <nav className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xs border border-surface-container-high">
          {desktopTabs(navigation).map((item) => {
            const isActive = item.key === navigation.active;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`${isStory ? "px-2.5 min-[1440px]:px-3.5" : "px-3.5"} py-1.5 rounded-xs text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-surface-container-highest text-on-surface font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3.5">
          {navigation.tabs === "story" && (
            <>
              {/* Same destination as the mobile header's Statement check button. */}
              <Link
                href={withImport("/analysis-summary", navigation.importId)}
                aria-label="Statement check"
                className={OUTLINE_BUTTON}
              >
                <Icon name="fact_check" size={16} />
                <span className="hidden xl:inline font-label text-[11px]">Statement check</span>
              </Link>
              <div className="h-5 w-px bg-surface-container-high" />
            </>
          )}
          <PrivateOnDevice />
          <RememberHeaderControls />
        </div>
      </div>
    </header>
  );
}
