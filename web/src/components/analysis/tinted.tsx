import type { ReactNode } from "react";

/** Money in's colour on a dark (inverse-surface) card, as on Overview's story card. */
export const MONEY_IN_ON_DARK = "text-primary-fixed";

/** Money out's colour on a dark card. */
export const MONEY_OUT_ON_DARK = "text-tertiary-fixed";

/**
 * `text` with each amount of `marks`, found in order, set in its colour
 * (semibold, tabular figures); the wording itself is unchanged, so copy
 * stays whole in content files.
 */
export function Tinted({ text, marks }: { text: string; marks: [amount: string, tone: string][] }) {
  const parts: ReactNode[] = [];
  let rest = text;
  marks.forEach(([amount, tone], index) => {
    const at = rest.indexOf(amount);
    if (at < 0) return;
    parts.push(
      rest.slice(0, at),
      <span key={index} className={`font-semibold tabular-nums ${tone}`}>
        {amount}
      </span>,
    );
    rest = rest.slice(at + amount.length);
  });
  parts.push(rest);
  return <>{parts}</>;
}
