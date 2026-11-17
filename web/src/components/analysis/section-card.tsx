import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

type SectionCardProps = {
  icon: string;
  title: string;
  subtitle?: string;
  /** Right side of the heading, e.g. a total. */
  aside?: ReactNode;
  children: ReactNode;
  /** The named exit at the bottom of the card. */
  footer?: ReactNode;
};

/**
 * IA prototype: the analysis card used across Breakdown areas, in the Stitch
 * card style: hairline border, its icon in a tinted tile beside the title.
 */
export function SectionCard({ icon, title, subtitle, aside, children, footer }: SectionCardProps) {
  return (
    <section className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm flex flex-col gap-space-md min-w-0">
      <div className="flex items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-space-sm">
            <span aria-hidden="true" className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon name={icon} size={16} />
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
          </div>
          {subtitle && <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{subtitle}</p>}
        </div>
        {aside && <div className="text-right shrink-0">{aside}</div>}
      </div>
      {children}
      {footer && <div className="pt-space-xs border-t border-surface-container-high">{footer}</div>}
    </section>
  );
}
