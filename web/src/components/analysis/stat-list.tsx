import Link from "next/link";
import { Icon } from "@/components/icon";
import { barWidthClass } from "@/lib/bar-width";

export type StatItem = {
  label: string;
  detail?: string;
  amount: string;
  share?: string;
  /** Bar width in percent; omitted for lists without a common whole. */
  width?: number;
  barTone?: string;
  href: string;
  /** "evidence": opens Ledger rows; "analysis": opens another area. */
  kind?: "evidence" | "analysis";
  muted?: boolean;
};

/**
 * IA prototype: a ranked list where every row is a door, to its Ledger rows
 * ("evidence") or to the analysis that explains it ("analysis"), with an
 * optional share and bar of a common whole.
 */
export function StatList({ items }: { items: StatItem[] }) {
  return (
    <ul className="flex flex-col gap-space-xs">
      {items.map((item) => (
        <li key={item.label}>
          <Link
            href={item.href}
            className="group flex flex-col gap-space-xs rounded-lg -mx-space-xs px-space-xs py-space-xs hover:bg-surface-container-low transition-colors"
          >
            <div className="flex items-baseline justify-between gap-space-sm">
              <div className="min-w-0">
                <span className={`font-body-md text-body-md font-semibold ${item.muted ? "text-on-surface-variant" : "text-on-surface"}`}>
                  {item.label}
                </span>
                {item.detail && (
                  <span className="block font-label-caps text-label-caps text-on-surface-variant normal-case tracking-normal">
                    {item.detail}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-space-xs shrink-0">
                <span className="font-label-numeric-md text-label-numeric-md font-semibold text-on-surface tabular-nums underline decoration-dotted decoration-primary/40 underline-offset-4 group-hover:decoration-solid">
                  {item.amount}
                </span>
                {item.share && (
                  <span className="font-label-caps text-label-caps text-on-surface-variant w-11 text-right tabular-nums">
                    {item.share}
                  </span>
                )}
                <Icon
                  name={item.kind === "analysis" ? "chevron_right" : "receipt_long"}
                  size={16}
                  className="text-primary/70"
                />
              </div>
            </div>
            {item.width !== undefined && (
              <div className="w-full h-1.5 bg-surface-container-high rounded-pill overflow-hidden">
                <div className={`h-full rounded-pill ${item.barTone ?? "bg-primary"} ${barWidthClass(Math.max(item.width, 1))}`} />
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
