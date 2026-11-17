import Link from "next/link";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS, hub, type AreaId } from "@/content/breakdown";
import { withImport } from "@/lib/import-link";

const CHIP = "inline-flex items-center gap-space-xs h-9 px-space-md rounded-lg font-body-sm text-body-sm whitespace-nowrap";

/**
 * The switcher between Breakdown areas (IA prototype), so every analysis
 * stays one tap away without a tab of its own; "All areas" returns to the
 * Breakdown home. It names all six areas: those with a screen are links that
 * keep import `importId` (withImport); those still coming (no destination)
 * are plain, non-interactive entries marked "Coming in this release", so they
 * never look like working destinations.
 */
export function BreakdownNav({ active, importId }: { active?: AreaId; importId: number | null }) {
  const links = [
    { id: "all", label: hub.allAreasLabel, icon: "donut_large", href: "/breakdown" },
    ...BREAKDOWN_AREAS.flatMap(({ id, label, icon, destination }) => (destination ? [{ id, label, icon, href: destination.href }] : [])),
  ];
  const coming = BREAKDOWN_AREAS.filter((area) => !area.destination);
  return (
    <nav aria-label="Breakdown areas" className="-mx-space-base md:mx-0">
      <ul className="flex items-center gap-space-xs overflow-x-auto px-space-base md:px-0 pb-1 lg:flex-wrap">
        {links.map((item) => {
          const isActive = item.id === (active ?? "all");
          return (
            <li key={item.id} className="shrink-0">
              <Link
                href={withImport(item.href, importId)}
                aria-current={isActive ? "page" : undefined}
                className={`${CHIP} transition-colors ${
                  isActive
                    ? "bg-primary text-on-primary font-semibold"
                    : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                }`}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </Link>
            </li>
          );
        })}
        {coming.map((area) => (
          <li key={area.id} className="shrink-0">
            <span className={`${CHIP} border border-dashed border-outline-variant text-on-surface-variant`}>
              <Icon name={area.icon} size={16} />
              {area.label}
              <span className="font-label-caps text-label-caps uppercase">{hub.comingLabel}</span>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
