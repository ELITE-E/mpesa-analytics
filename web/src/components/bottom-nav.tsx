import Link from "next/link";
import { Icon } from "@/components/icon";

export type NavKey = "ingest" | "ledger" | "tariffs";

/** The ingest screens' tabs: the mobile tab bar and the desktop app bar both render these. */
export const INGEST_NAV_ITEMS: { key: NavKey; label: string; icon: string; href: string }[] = [
  { key: "ingest", label: "Ingest", icon: "upload_file", href: "/upload" },
  { key: "ledger", label: "Ledger", icon: "table_chart", href: "/ledger" },
  { key: "tariffs", label: "Tariffs", icon: "monitoring", href: "/breakdown/fees" },
];

/**
 * Fixed mobile and tablet tab bar of the ingest screens, marking `active` as
 * the current page. It is `display: none` from 1024px, where the desktop app
 * bar carries the same tabs.
 */
export function BottomNav({ active }: { active: NavKey }) {
  return (
    <nav className="lg:hidden fixed bottom-0 w-full z-50 pb-safe bg-surface/85 backdrop-blur-xl shadow-[0_-2px_12px_rgba(0,0,0,0.03)]">
      <div className="h-16 px-4 md:px-6 flex items-center justify-around">
        {INGEST_NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 w-14 h-12 transition-colors ${
                isActive ? "text-primary font-semibold" : "text-on-surface-variant"
              }`}
            >
              <Icon name={item.icon} size={22} />
              <span className="text-[10px] font-headline">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
