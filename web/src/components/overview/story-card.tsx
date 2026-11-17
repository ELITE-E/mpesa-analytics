import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { MONEY_IN_ON_DARK as IN_TONE, MONEY_OUT_ON_DARK as OUT_TONE } from "@/components/analysis/tinted";
import { Icon } from "@/components/icon";
import { story } from "@/content/overview";
import { formatCount, formatKes } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { OverviewFigures } from "@/lib/statement/overview";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}


/**
 * The closing sentence, by the sign of the API's net flow: higher (the net
 * in money in's colour), lower (in money out's) or unchanged; the closing
 * balance stands out in the card's text colour.
 */
function ClosingSentence({ netCents, closing }: { netCents: number; closing: string }) {
  const balance = <span className="font-semibold tabular-nums">{closing}</span>;
  if (netCents === 0) {
    return (
      <>
        {story.unchanged} {balance} {story.left}
      </>
    );
  }
  const [before, after, tone] = netCents > 0 ? [story.higher, story.higherAfter, IN_TONE] : [story.lower, story.lowerAfter, OUT_TONE];
  return (
    <>
      {before} <span className={`font-semibold tabular-nums ${tone}`}>{kes(Math.abs(netCents))}</span> {after} {balance} {story.left}
    </>
  );
}

/**
 * IA prototype: Overview's answer to "What happened to my money?" in one
 * paragraph, from the API's cash flow (money in, money out, net, closing),
 * on the Stitch synthesis card's dark background with money in and out in
 * their own colours. Money in and out are doors to their Ledger scopes,
 * whose rows add up to them; the hint counts statement lines (Q-D5).
 */
export function StoryCard({
  period,
  figures,
  importId,
}: {
  period: string;
  figures: Pick<OverviewFigures, "moneyIn" | "moneyOut" | "netCents" | "closingCents" | "lineCount">;
  importId: number | null;
}) {
  const door = (scopeId: string) => ledgerHref({ scopeId, from: "overview", importId });
  return (
    <section className="relative overflow-hidden bg-inverse-surface text-inverse-on-surface rounded-xl p-space-base shadow-md flex flex-col gap-space-sm">
      <div aria-hidden="true" className="absolute -right-8 -top-8 w-32 h-32 rounded-pill bg-primary-container/20 pointer-events-none blur-2xl" />
      <div className="relative flex items-center gap-space-xs">
        <Icon name="auto_stories" size={18} className={IN_TONE} />
        <span className="font-label-caps text-label-caps uppercase tracking-wider text-surface-variant">{story.label(period)}</span>
      </div>
      <p className="relative font-headline text-lg lg:text-xl leading-relaxed text-inverse-on-surface text-balance">
        <Door href={door(figures.moneyIn.scopeId)} className={`font-semibold ${IN_TONE} ${DOOR_ON_DARK}`}>
          {kes(figures.moneyIn.cents)}
        </Door>{" "}
        {story.cameIn}{" "}
        <Door href={door(figures.moneyOut.scopeId)} className={`font-semibold ${OUT_TONE} ${DOOR_ON_DARK}`}>
          {kes(figures.moneyOut.cents)}
        </Door>{" "}
        {story.wentOut} <ClosingSentence netCents={figures.netCents} closing={kes(figures.closingCents)} />
      </p>
      <p className="relative font-body-sm text-body-sm text-surface-variant">{story.hint(formatCount(figures.lineCount, "statement line"))}</p>
    </section>
  );
}
