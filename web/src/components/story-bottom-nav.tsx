import Link from "next/link";
import { Icon } from "@/components/icon";
import { withImport } from "@/lib/import-link";

export type StoryNavKey = "overview" | "breakdown" | "ledger";

/**
 * The story screens' three levels (IA prototype): Overview, Breakdown (home
 * of every analysis area) and Ledger (the evidence), named by label only.
 * The mobile tab bar and the desktop app bar both render these; the ingestion
 * screens keep BottomNav.
 */
export const STORY_NAV_ITEMS: { key: StoryNavKey; label: string; icon: string; href: string }[] = [
  { key: "overview", label: "Overview", icon: "analytics", href: "/overview" },
  { key: "breakdown", label: "Breakdown", icon: "donut_large", href: "/breakdown" },
  { key: "ledger", label: "Ledger", icon: "receipt_long", href: "/ledger" },
];

/**
 * Fixed mobile and tablet tab bar of the story screens. `active` is the
 * screen's level, omitted on screens without one; `importId` keeps every tab
 * on the same import (withImport). It is `display: none` from 1024px, where
 * the desktop app bar carries the same levels.
 */
export function StoryBottomNav({
  active,
  importId = null,
}: {
  active?: StoryNavKey;
  importId?: number | null;
}) {
  return (
    <nav className="lg:hidden fixed bottom-0 w-full z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-2px_12px_rgba(0,0,0,0.04)]">
      <div className="h-16 flex items-center justify-around px-space-xs md:px-6">
        {STORY_NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={withImport(item.href, importId)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center flex-1 max-w-32 h-12 rounded-xl transition-colors ${
                isActive
                  ? "text-primary font-semibold"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon name={item.icon} size={22} />
              <span className="font-label-caps text-label-caps mt-0.5 tracking-normal">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
