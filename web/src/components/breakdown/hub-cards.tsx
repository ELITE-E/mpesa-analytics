import Link from "next/link";
import { Door } from "@/components/analysis/door";
import { SectionCard } from "@/components/analysis/section-card";
import { Icon } from "@/components/icon";
import { addsUp, hub, type BreakdownArea } from "@/content/breakdown";
import { BUCKET_LABELS } from "@/content/ledger";
import { unverified } from "@/content/overview";
import { formatCount, formatKes, formatShare } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { AreaFigure, HubBreakdown, HubFigures } from "@/lib/statement/hub";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a hub door: scope `scopeId`, back to the hub, on import `importId`. */
function hubDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "breakdown", importId });
}

/**
 * The hub's question and answer: the API's money out and in once the import
 * has loaded, each a door to its rows only when verified (out: U-2 and U-3;
 * in: U-1), then the way into every transaction. While the import loads
 * (`figures` null) it shows no figure. Figure doors open import
 * `doorImportId` (the one the figures came from); the Ledger link keeps the
 * page's `importId` (none: the latest import).
 */
export function HubHeader({ figures, importId, doorImportId = importId }: { figures: HubFigures | null; importId: number | null; doorImportId?: number | null }) {
  const shown = figures?.breakdown?.status === "shown" ? figures.breakdown : null;
  const amount = (cents: number, scopeId: string, linked: boolean, tone: string) =>
    linked ? (
      <Door href={hubDoor(scopeId, doorImportId)} className={`font-semibold ${tone}`}>
        {kes(cents)}
      </Door>
    ) : (
      <span className={`font-semibold tabular-nums ${tone}`}>{kes(cents)}</span>
    );
  return (
    <section className="flex flex-col gap-space-xs">
      <h2 className="font-headline text-xl font-bold tracking-tight text-on-surface text-balance">{hub.question}</h2>
      <p className="font-body-md text-body-md text-on-surface-variant">
        {figures && (
          <>
            {amount(figures.moneyOut.cents, figures.moneyOut.scopeId, shown !== null, "text-on-surface")} {hub.wentOut}{" "}
            {amount(figures.moneyIn.cents, figures.moneyIn.scopeId, shown?.inflowVerified === true, "text-primary")} {hub.cameIn}{" "}
          </>
        )}
        {hub.description} {hub.ledgerLead}{" "}
        <Door href={withImport("/ledger", importId)} label={hub.ledgerDoorLabel} className="font-semibold text-on-surface">
          {hub.ledgerDoor}
        </Door>
        .
      </p>
    </section>
  );
}

/**
 * One Breakdown area on the hub (IA prototype AreaCard): its question, its
 * headline figure as a door to its rows (with its share of money out when
 * given), and the way into its screen. A real zero says so without a door;
 * with `figure` null (loading or withheld) only the question and link show.
 * `linked` false keeps a figure without its door (money in without U-1).
 * The figure's door opens import `doorImportId`; the area link keeps the
 * page's `importId`.
 */
export function AreaCard({
  area,
  figure,
  linked = true,
  importId,
  doorImportId = importId,
}: {
  area: BreakdownArea;
  figure: AreaFigure | null;
  linked?: boolean;
  importId: number | null;
  doorImportId?: number | null;
}) {
  const { destination } = area;
  return (
    <article className="bg-surface-container-lowest rounded-xl p-space-base border border-hairline shadow-sm flex flex-col gap-space-sm min-w-0">
      <div className="flex items-center gap-space-xs">
        <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon name={area.icon} size={18} />
        </span>
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">{area.label}</span>
      </div>
      <h3 className="font-headline-sm text-headline-sm text-on-surface text-balance">{area.question}</h3>
      {figure && (
        <div className="flex items-baseline justify-between gap-space-sm flex-wrap">
          {figure.count > 0 && linked ? (
            <Door href={hubDoor(figure.scopeId, doorImportId)} label={`See the ${formatCount(figure.count, "row")} behind ${kes(figure.cents)}`} className="font-label-numeric-lg text-label-numeric-lg text-on-surface">
              {kes(figure.cents)}
            </Door>
          ) : (
            <span className="font-label-numeric-lg text-label-numeric-lg text-on-surface tabular-nums">{kes(figure.cents)}</span>
          )}
          {figure.count === 0 ? (
            <span className="font-label-caps text-label-caps text-on-surface-variant normal-case tracking-normal">{hub.none}</span>
          ) : (
            figure.share !== null && <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums normal-case tracking-normal">{hub.shareOfOut(formatShare(figure.share))}</span>
          )}
        </div>
      )}
      {destination ? (
        <Link
          href={withImport(destination.href, importId)}
          className="mt-auto inline-flex items-center justify-between gap-space-xs min-h-11 px-space-md rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-body-sm text-body-sm font-semibold transition-colors"
        >
          {hub.openPrefix} {destination.screen}
          <Icon name="arrow_forward" size={18} className="text-primary" />
        </Link>
      ) : (
        <p className="mt-auto font-label-caps text-label-caps uppercase text-on-surface-variant">{hub.comingLabel}</p>
      )}
    </article>
  );
}

/**
 * How the parts add up (IA prototype AddsUpCard, DR-5): every outflow bucket
 * with money in it, whether an area covers it or not (Not yet classified,
 * Airtime, Reversals…), each a door to its rows, adding up to the API's money
 * out, itself a door; with the note on payments not recognised yet. Under
 * T-UNVERIFIED only R2.2's wording shows.
 */
export function AddsUpCard({ breakdown, moneyOut, importId }: { breakdown: HubBreakdown; moneyOut: HubFigures["moneyOut"]; importId: number | null }) {
  return (
    <SectionCard icon="functions" title={addsUp.title} subtitle={addsUp.subtitle}>
      {breakdown.status === "unverified" ? (
        <p data-unverified="" className="font-body-sm text-body-sm text-on-surface-variant">
          {unverified}
        </p>
      ) : breakdown.parts.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{addsUp.empty}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-space-xs font-body-sm text-body-sm">
            {breakdown.parts.map((part) => (
              <div key={part.bucket} className="flex items-center justify-between gap-space-sm">
                <dt className="text-on-surface-variant min-w-0">{BUCKET_LABELS[part.bucket]}</dt>
                <dd className="shrink-0">
                  <Door href={hubDoor(part.scopeId, importId)} className="font-label-numeric-sm text-label-numeric-sm text-on-surface">
                    {kes(part.cents)}
                  </Door>
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-space-sm pt-space-xs mt-space-2xs border-t border-surface-container-high">
              <dt className="font-semibold text-on-surface">{addsUp.total}</dt>
              <dd className="shrink-0">
                <Door href={hubDoor(moneyOut.scopeId, importId)} className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface">
                  {kes(moneyOut.cents)}
                </Door>
              </dd>
            </div>
          </dl>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{addsUp.unrecognised}</p>
        </>
      )}
    </SectionCard>
  );
}
