import Link from "next/link";
import { AreaHeader } from "@/components/analysis/area-header";
import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { NoteCard } from "@/components/analysis/note-card";
import { SectionCard } from "@/components/analysis/section-card";
import { StatList } from "@/components/analysis/stat-list";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS } from "@/content/breakdown";
import { unverified } from "@/content/overview";
import { area, largest, limits, months as monthsCopy, notSpending, otherSavings, places as placesCopy, split } from "@/content/savings";
import { formatCount, formatDateTime, formatKes, formatMonth, formatShare } from "@/lib/format";
import { share } from "@/lib/statement/totals";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { DepositFigure, MonthFigure, PlaceFigure, SavingsBreakdown, SavingsFigures } from "@/lib/statement/savings";
import { barWidthClass } from "@/lib/bar-width";

type ShownBreakdown = Extract<SavingsBreakdown, { status: "shown" }>;

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a Savings door: scope `scopeId`, back to Savings, on import `importId`. */
function savingsDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "savings", importId });
}

/** Segment colours of the split bar, in order (the Stitch gauge's); places beyond them are grouped. */
const SPLIT_TONES = ["bg-primary-fixed", "bg-secondary-fixed", "bg-tertiary-fixed"];

/**
 * How the total set aside divides across places (the Stitch Investments
 * gauge, from the rows): the largest places first, up to three named, any
 * others grouped, each segment as wide as its DR-7 share; with a legend.
 * Display only: each place's door is in "Where it went".
 */
function SplitBar({ places, totalCents }: { places: PlaceFigure[]; totalCents: number }) {
  const named = places.slice(0, SPLIT_TONES.length).map((place, index) => ({ key: place.entity, label: place.label, share: place.share, tone: SPLIT_TONES[index] }));
  const restCents = places.slice(SPLIT_TONES.length).reduce((sum, place) => sum + place.cents, 0);
  const segments = restCents > 0 ? [...named, { key: "others", label: split.others, share: share(restCents, totalCents), tone: "bg-surface-variant" }] : named;
  return (
    <div className="flex flex-col gap-space-xs pt-space-xs">
      <span className="font-label-caps text-label-caps uppercase text-surface-container-highest/80">{split.title}</span>
      <div className="h-2 w-full rounded-pill bg-surface-variant/20 flex overflow-hidden">
        {segments.map((segment) => (
          <div key={segment.key} title={`${segment.label}: ${formatShare(segment.share)}`} className={`h-full ${segment.tone} ${barWidthClass(segment.share)}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-space-md gap-y-space-2xs font-label-caps text-label-caps normal-case tracking-normal text-surface-container-highest">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1 min-w-0">
            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-pill shrink-0 ${segment.tone}`} />
            <span className="truncate max-w-[16rem]">{segment.label}</span>
            <span className="tabular-nums shrink-0">({formatShare(segment.share)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The header's answer, light on the dark card: deposits and places, the DR-7
 * share of money in in money in's colour (or why it is withheld), that none
 * of it is spending, the split across places, and the T-DERIVED note.
 */
function Answer({ breakdown }: { breakdown: ShownBreakdown }) {
  const { total, shareOfIn } = breakdown;
  return (
    <div className="flex flex-col gap-space-xs">
      <p>
        {area.deposits(formatCount(total.count, "deposit"), total.places)}
        {shareOfIn.verified && (
          <>
            {", "}
            <span className="font-semibold tabular-nums text-primary-fixed">{formatShare(shareOfIn.share)}</span>
            {area.shareOfInAfter}
          </>
        )}
        {`. ${area.notSpending}`}
      </p>
      {!shareOfIn.verified && <p data-unverified="">{area.shareUnverified}</p>}
      {breakdown.places.length > 0 && <SplitBar places={breakdown.places} totalCents={total.cents} />}
      <p className="flex items-center gap-space-2xs font-label-caps text-label-caps text-surface-container-highest/80 normal-case tracking-normal">
        <Icon name="info" size={14} className="text-primary-fixed-dim" />
        {area.derived}
      </p>
    </div>
  );
}

/**
 * The Savings area's header (IA prototype AreaHeader): the question, the
 * set-aside figure as a door to every deposit, and the answer. Under
 * T-UNVERIFIED the API's total stays, without a door, beside R2.2's wording;
 * with nothing set aside it says so, over a real KES 0.00. Shown on the dark
 * card with the Stitch Investments glow.
 */
export function SavingsHeader({ api, breakdown, importId }: Pick<SavingsFigures, "api" | "breakdown"> & { importId: number | null }) {
  const header = { label: area.title, question: area.question, figureLabel: area.figureLabel, importId, tone: "dark" as const, glow: "top-right" as const };
  if (!breakdown || breakdown.status === "unverified") {
    return (
      <AreaHeader
        {...header}
        figure={kes(api.totalCents)}
        answer={
          <div className="flex flex-col gap-space-xs">
            <p>{area.apiTotal(kes(api.totalCents))}</p>
            {breakdown && <p data-unverified="">{unverified}</p>}
          </div>
        }
      />
    );
  }
  if (breakdown.total.count === 0) return <AreaHeader {...header} figure={kes(0)} answer={<p>{area.none}</p>} />;
  const figure = (
    <Door href={savingsDoor(breakdown.total.scopeId, importId)} label={`See the ${formatCount(breakdown.total.count, "deposit")} behind ${kes(breakdown.total.cents)}`} className={DOOR_ON_DARK}>
      {kes(breakdown.total.cents)}
    </Door>
  );
  return <AreaHeader {...header} figure={figure} answer={<Answer breakdown={breakdown} />} />;
}

/** Why money set aside is never counted as Spending (the prototype's clarification card). */
export function NotSpendingNote() {
  return (
    <NoteCard icon="account_balance" title={notSpending.title}>
      <p>{notSpending.body}</p>
    </NoteCard>
  );
}

/** Every place money was set aside (DR-8, the exact stored name), largest first, each with its DR-7 share and a door to its deposits. */
export function PlacesCard({ places, importId }: { places: PlaceFigure[]; importId: number | null }) {
  return (
    <SectionCard icon="account_balance_wallet" title={placesCopy.title} subtitle={placesCopy.subtitle}>
      {places.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{placesCopy.none}</p>
      ) : (
        <StatList
          items={places.map((place) => ({
            label: place.label,
            detail: placesCopy.detail(formatCount(place.count, "deposit")),
            amount: kes(place.cents),
            share: formatShare(place.share),
            width: place.share ?? 0,
            href: savingsDoor(place.scopeId, importId),
            muted: place.label !== place.entity,
          }))}
        />
      )}
    </SectionCard>
  );
}

/** Deposits by calendar month, oldest first: plain figures (no Ledger scope names a month); unreadable times are named. */
export function MonthsCard({ months }: { months: MonthFigure[] }) {
  return (
    <SectionCard icon="timeline" title={monthsCopy.title} subtitle={monthsCopy.subtitle}>
      <ul className="flex flex-col gap-space-xs">
        {months.map((month) => (
          <li key={month.month ?? "unreadable"} className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low">
            <div className="min-w-0">
              <span className="block font-body-sm text-body-sm font-semibold text-on-surface">{month.month ? formatMonth(month.month) : monthsCopy.unreadable}</span>
              <span className="font-label-caps text-label-caps text-on-surface-variant normal-case tracking-normal">{formatCount(month.count, "deposit")}</span>
            </div>
            <span className="font-label-numeric-sm text-label-numeric-sm font-semibold text-on-surface tabular-nums shrink-0">{kes(month.cents)}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** One of the largest deposits: where, when, the principal and its linked charge; a door to its receipt. */
function DepositRow({ deposit, importId }: { deposit: DepositFigure; importId: number | null }) {
  return (
    <Link
      href={savingsDoor(deposit.scopeId, importId)}
      className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="receipt-badge shrink-0">{deposit.receiptNo}</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface truncate">{deposit.label}</span>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums normal-case tracking-normal">{formatDateTime(deposit.time)}</span>
      </div>
      <div className="text-right shrink-0">
        <span className="block font-label-numeric-sm text-label-numeric-sm font-semibold text-on-surface tabular-nums">{kes(deposit.cents)}</span>
        <span className={deposit.chargeCents > 0 ? "charge-pill tabular-nums" : "font-label-caps text-label-caps tabular-nums normal-case tracking-normal text-on-surface-variant"}>
          {deposit.chargeCents > 0 ? largest.charge(kes(deposit.chargeCents)) : largest.noCharge}
        </span>
      </div>
    </Link>
  );
}

/**
 * The largest deposits by principal, each opening its receipt, the charges
 * linked to deposits (Q-LINK: display only, counted in Fees, which is linked
 * by its existing screen), then one exit to every deposit in Ledger.
 */
export function LargestDepositsCard({
  deposits,
  depositCount,
  depositCharges,
  importId,
}: {
  deposits: DepositFigure[];
  depositCount: number;
  depositCharges: ShownBreakdown["depositCharges"];
  importId: number | null;
}) {
  const fees = BREAKDOWN_AREAS.find((entry) => entry.id === "fees")?.destination;
  return (
    <SectionCard
      icon="receipt_long"
      title={largest.title}
      subtitle={largest.subtitle}
      footer={
        depositCount > 0 ? (
          <Link
            href={savingsDoor("bucket:set-aside", importId)}
            className="w-full min-h-11 rounded-lg bg-primary text-on-primary flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-colors"
          >
            {largest.exit(depositCount)}
            <Icon name="arrow_forward" size={16} />
          </Link>
        ) : undefined
      }
    >
      {deposits.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{largest.none}</p>
      ) : (
        <div className="flex flex-col gap-space-xs">
          {deposits.map((deposit) => (
            <DepositRow key={deposit.receiptNo} deposit={deposit} importId={importId} />
          ))}
        </div>
      )}
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {depositCharges.count > 0 ? largest.carried(kes(depositCharges.cents), depositCharges.count) : largest.noCharges}{" "}
        {fees ? (
          <Link href={withImport(fees.href, importId)} className="text-primary font-semibold hover:underline">
            {largest.fees}
          </Link>
        ) : (
          largest.fees
        )}
        .
      </p>
    </SectionCard>
  );
}

/** What the statement can't show about savings, and what the engine recognises as set aside. */
export function LimitsNote() {
  return (
    <NoteCard icon="info" title={limits.title} tone="honest">
      <p>{limits.balances}</p>
      <p>{limits.recognised}</p>
    </NoteCard>
  );
}

/** Other savings products can't be recognised yet: a T-PLANNED note (Q-P1 label), no figure and no link. */
export function OtherSavingsNote() {
  return (
    <NoteCard icon="savings" title={otherSavings.title} planned={otherSavings.planned}>
      <p>{otherSavings.body}</p>
    </NoteCard>
  );
}
