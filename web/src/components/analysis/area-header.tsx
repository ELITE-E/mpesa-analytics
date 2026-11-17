import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { withImport } from "@/lib/import-link";

type AreaHeaderProps = {
  /** The area's name, the breadcrumb's current entry. */
  label: string;
  /** The area's question; an h2, since the story screen already has the page's h1. */
  question: string;
  /** The headline figure, usually a Door to its rows. */
  figure: ReactNode;
  figureLabel: string;
  /** One or two sentences answering the question. */
  answer: ReactNode;
  importId: number | null;
  /**
   * "dark": the question, answer and figure sit on the Stitch KPI banner's
   * dark card (inverse surface, green glow); the area's own content must
   * then use light-on-dark colours (a figure Door adds DOOR_ON_DARK).
   * Areas move to it one at a time; "light" is the original layout.
   */
  tone?: "light" | "dark";
  /** Where the dark card's glow sits: bottom right (Stitch Spending) or a larger one top right (Stitch Investments). */
  glow?: "bottom-right" | "top-right";
};

/**
 * IA prototype: the top of every Breakdown area: where you are (a breadcrumb
 * back to the Breakdown home on import `importId`), the question, the answer
 * and the figure it rests on, in the original light layout or on the dark
 * card (`tone`).
 */
export function AreaHeader({ label, question, figure, figureLabel, answer, importId, tone = "light", glow = "bottom-right" }: AreaHeaderProps) {
  return (
    <header className="flex flex-col gap-space-md">
      <nav aria-label="Breadcrumb" className="flex items-center gap-space-2xs font-label-caps text-label-caps uppercase text-on-surface-variant">
        <Link href={withImport("/breakdown", importId)} className="hover:text-primary hover:underline">
          Breakdown
        </Link>
        <Icon name="chevron_right" size={14} />
        <span aria-current="page" className="text-primary font-semibold">
          {label}
        </span>
      </nav>
      {tone === "dark" ? (
        <section className={`relative overflow-hidden bg-inverse-surface text-inverse-on-surface rounded-xl p-space-base lg:p-space-lg ${glow === "top-right" ? "shadow-md" : "shadow-sm"}`}>
          {glow === "top-right" ? (
            <div aria-hidden="true" className="absolute -right-12 -top-12 w-48 h-48 bg-primary/20 rounded-pill blur-3xl pointer-events-none" />
          ) : (
            <div aria-hidden="true" className="absolute -right-6 -bottom-6 w-32 h-32 bg-primary-container/20 rounded-pill blur-2xl pointer-events-none" />
          )}
          <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-space-md">
            <div className="flex flex-col gap-space-xs max-w-2xl min-w-0">
              <h2 className="font-headline text-2xl lg:text-3xl font-bold tracking-tight text-inverse-on-surface text-balance">{question}</h2>
              <div className="font-body-md text-body-md text-surface-container-highest">{answer}</div>
            </div>
            <div className="flex flex-col lg:items-end shrink-0">
              <span className="flex items-center gap-space-xs font-label-caps text-label-caps uppercase tracking-widest text-surface-container-highest">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-pill bg-primary-fixed-dim" />
                {figureLabel}
              </span>
              <span className="font-label-numeric-lg text-label-numeric-lg text-inverse-on-surface">{figure}</span>
            </div>
          </div>
        </section>
      ) : (
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-space-md">
          <div className="flex flex-col gap-space-xs max-w-2xl min-w-0">
            <h2 className="font-headline text-2xl lg:text-3xl font-bold tracking-tight text-on-surface text-balance">{question}</h2>
            <div className="font-body-md text-body-md text-on-surface-variant">{answer}</div>
          </div>
          <div className="bg-surface-container-lowest rounded-xl px-space-base py-space-sm border border-hairline shadow-sm flex flex-col lg:items-end shrink-0">
            <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">{figureLabel}</span>
            <span className="font-label-numeric-lg text-label-numeric-lg text-on-surface">{figure}</span>
          </div>
        </div>
      )}
    </header>
  );
}
