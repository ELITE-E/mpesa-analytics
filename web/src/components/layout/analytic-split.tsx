import type { ReactNode } from "react";

export type SplitPanel = {
  /** Position in the single mobile/tablet column (1–9, unique across both groups). */
  order: number;
  content: ReactNode;
};

/** Column spans of the two desktop panels; also used by screens that compose the split themselves. */
export const PRIMARY_SPAN = "lg:col-span-7 xl:col-span-8";
export const INSPECTOR_SPAN = "lg:col-span-5 xl:col-span-4";

// Tailwind needs literal class names.
const ORDER = ["", "order-1", "order-2", "order-3", "order-4", "order-5", "order-6", "order-7", "order-8", "order-9"];

type AnalyticSplitProps = {
  primary: SplitPanel[];
  inspector: SplitPanel[];
  /** Gap of the single column below 1024px, e.g. the screen's existing mobile gap. */
  gapClassName: string;
};

/**
 * DESIGN.md's desktop multi-panel layout: an 8-column primary canvas beside a
 * 4-column inspector from 1280px (the width Stitch designed at), 7/5 between
 * 1024 and 1279px so the inspector keeps the ~380px its mobile cards were
 * designed for. Below 1024px both groups dissolve (display: contents) and
 * their panels fall back into one column in `order`, so mobile and tablet keep
 * the screen's original stacking.
 *
 * Contract: each panel's `order` is an integer from 1 to 9 (the literal
 * classes Tailwind can see) and is unique across both groups, since it is
 * both the panel's mobile position and its React key. From 1024px panels
 * appear in array order within their group. The component only arranges
 * the content it is given; it fetches and computes nothing.
 */
export function AnalyticSplit({ primary, inspector, gapClassName }: AnalyticSplitProps) {
  /** Wrap each panel so it takes its mobile `order` and drops it from 1024px. */
  const renderPanels = (panels: SplitPanel[]) =>
    panels.map((panel) => (
      <div key={panel.order} className={`${ORDER[panel.order]} lg:order-none`}>
        {panel.content}
      </div>
    ));

  return (
    <div className={`flex flex-col ${gapClassName} lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start`}>
      <div className={`contents ${PRIMARY_SPAN} lg:flex lg:flex-col lg:gap-6`}>{renderPanels(primary)}</div>
      <div className={`contents ${INSPECTOR_SPAN} lg:flex lg:flex-col lg:gap-6`}>{renderPanels(inspector)}</div>
    </div>
  );
}
