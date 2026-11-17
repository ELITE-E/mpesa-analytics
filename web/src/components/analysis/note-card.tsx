import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

type NoteCardProps = {
  icon: string;
  title: string;
  children: ReactNode;
  /** "info": a plain explanation; "honest": a limit of what the statement can show. */
  tone?: "info" | "honest";
  /** A T-PLANNED label beside the title (Q-P1), e.g. "Not available yet". */
  planned?: string;
};

/**
 * IA prototype: a short explanation in the flow of an analysis: why
 * something is or isn't counted, or what the statement can't tell us. A
 * planned capability carries its T-PLANNED label and no figure. Its icon
 * sits in a tinted tile (green for info, slate for honest), like the
 * section cards'.
 */
export function NoteCard({ icon, title, children, tone = "info", planned }: NoteCardProps) {
  const toneClasses = tone === "honest" ? "bg-secondary-container/50 border-secondary/30" : "bg-surface-container-low border-hairline";
  const tileClasses = tone === "honest" ? "bg-secondary/10 text-secondary" : "bg-primary/10 text-primary";
  return (
    <section data-planned={planned ? "" : undefined} className={`rounded-xl p-space-base border ${toneClasses} flex gap-space-sm min-w-0`}>
      <span aria-hidden="true" className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tileClasses}`}>
        <Icon name={icon} size={18} />
      </span>
      <div className="flex flex-col gap-space-xs min-w-0">
        <div className="flex flex-wrap items-center gap-space-xs">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
          {planned && (
            <span className="inline-flex items-center px-1.5 py-px rounded-xs bg-surface-container-highest text-on-surface-variant font-label-caps text-label-caps uppercase whitespace-nowrap">
              {planned}
            </span>
          )}
        </div>
        <div className="font-body-sm text-body-sm text-on-surface-variant flex flex-col gap-space-xs">{children}</div>
      </div>
    </section>
  );
}
