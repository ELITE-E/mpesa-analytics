import Link from "next/link";
import { AreaHeader } from "@/components/analysis/area-header";
import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { NoteCard } from "@/components/analysis/note-card";
import { SectionCard } from "@/components/analysis/section-card";
import { StatList } from "@/components/analysis/stat-list";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS } from "@/content/breakdown";
import { area, CAUSE_AREA, causes as causesCopy, composition, countedOnce, excise, free as freeCopy, largest } from "@/content/fees-area";
import { chargeCauseLabel } from "@/content/ledger";
import { unverified } from "@/content/overview";
import { formatCount, formatDateTime, formatKes, formatShare } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import { UNLINKED_CAUSE } from "@/lib/statement/charges";
import type { CauseFigure, ChargeFigure, FeesBreakdown, FeesFigures } from "@/lib/statement/fees";
import { barWidthClass } from "@/lib/bar-width";

type ShownBreakdown = Extract<FeesBreakdown, { status: "shown" }>;

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a Fees door: scope `scopeId`, back to Fees, on import `importId`. */
function feesDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "fees", importId });
}

/**
 * Money out split into payments and charges (the Stitch Fees composition
 * bar, from the verified DR-7 share): the charges segment, in money out's
 * amber, as wide as their share. Display only; shown only when the share is.
 */
function CompositionBar({ chargeShare }: { chargeShare: number }) {
  return (
    <div className="flex flex-col gap-space-xs pt-space-xs">
      <div className="flex items-center justify-between gap-space-sm font-label-caps text-label-caps text-surface-container-highest/80">
        <span className="uppercase">{composition.title}</span>
        <span className="flex items-center gap-space-sm normal-case tracking-normal">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-pill bg-primary-fixed-dim" />
            {composition.payments}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-pill bg-tertiary-fixed-dim" />
            {composition.charges(formatShare(chargeShare))}
          </span>
        </span>
      </div>
      <div className="h-2 w-full rounded-pill bg-primary-fixed-dim flex justify-end overflow-hidden">
        <div className={`h-full bg-tertiary-fixed-dim ${barWidthClass(Math.max(chargeShare, 0.5))}`} />
      </div>
    </div>
  );
}

/**
 * The header's answer, light on the dark card: charges and the payments they
 * were on, the DR-7 share of money out in money out's amber (or why it is
 * withheld), the unlinked disclosure, the composition bar and the T-DERIVED
 * note.
 */
function Answer({ breakdown }: { breakdown: ShownBreakdown }) {
  const { total, shareOfOut, unlinkedCount } = breakdown;
  return (
    <div className="flex flex-col gap-space-xs">
      <p>
        {area.answer(formatCount(total.count, "charge"), breakdown.chargedPayments, breakdown.paymentsOut)}
        {shareOfOut.verified && (
          <>
            {", "}
            <span className="font-semibold tabular-nums text-tertiary-fixed">{formatShare(shareOfOut.share)}</span>
            {area.shareOfOutAfter}
          </>
        )}
        .
      </p>
      {!shareOfOut.verified && <p data-unverified="">{area.shareUnverified}</p>}
      {unlinkedCount > 0 && <p className="font-body-sm text-body-sm">{area.unlinked(formatCount(unlinkedCount, "charge"))}</p>}
      {shareOfOut.verified && shareOfOut.share !== null && <CompositionBar chargeShare={shareOfOut.share} />}
      <p className="flex items-center gap-space-2xs font-label-caps text-label-caps text-surface-container-highest/80 normal-case tracking-normal">
        <Icon name="info" size={14} className="text-primary-fixed-dim" />
        {area.derived}
      </p>
    </div>
  );
}

/**
 * The Fees area's header (IA prototype AreaHeader): the question, the API's
 * charges paid as a door to every charge, and the answer. Without rows
 * (T-LOADFAIL) or under T-UNVERIFIED the API's total stays, without a door
 * (R2.2's wording for the latter); with no charges it says so, over a real
 * KES 0.00. Shown on the dark card (the Stitch Fees KPI card).
 */
export function FeesHeader({ api, breakdown, importId }: Pick<FeesFigures, "api" | "breakdown"> & { importId: number | null }) {
  const header = { label: area.title, question: area.question, figureLabel: area.figureLabel, importId, tone: "dark" as const };
  if (!breakdown || breakdown.status === "unverified") {
    return (
      <AreaHeader
        {...header}
        figure={kes(api.cents)}
        answer={
          <div className="flex flex-col gap-space-xs">
            <p>{area.apiTotal(kes(api.cents))}</p>
            {breakdown && <p data-unverified="">{unverified}</p>}
          </div>
        }
      />
    );
  }
  if (breakdown.total.count === 0) return <AreaHeader {...header} figure={kes(0)} answer={<p>{area.none}</p>} />;
  const figure = (
    <Door href={feesDoor(api.scopeId, importId)} label={`See the ${formatCount(breakdown.total.count, "charge")} behind ${kes(api.cents)}`} className={DOOR_ON_DARK}>
      {kes(api.cents)}
    </Door>
  );
  return <AreaHeader {...header} figure={figure} answer={<Answer breakdown={breakdown} />} />;
}

/** The Breakdown areas the causes' transactions belong to, in cause order, each once, with their screens. */
function causeAreas(causes: CauseFigure[]) {
  const ids = [...new Set(causes.flatMap((cause) => (CAUSE_AREA[cause.cause] ? [CAUSE_AREA[cause.cause]] : [])))];
  return ids.flatMap((id) => {
    const entry = BREAKDOWN_AREAS.find((candidate) => candidate.id === id);
    return entry?.destination ? [{ id, label: entry.label, href: entry.destination.href }] : [];
  });
}

/**
 * What caused the charges (decision Q-D7): each cause, the kind of
 * transaction a charge was for, with its charges, their DR-7 share and a
 * door to exactly those charges (the only amount on it); charges not linked to one transaction
 * are their own cause. Then the areas those transactions belong to.
 */
export function CausesCard({ causes, importId }: { causes: CauseFigure[]; importId: number | null }) {
  const areas = causeAreas(causes);
  return (
    <SectionCard icon="receipt" title={causesCopy.title} subtitle={causesCopy.subtitle}>
      {causes.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{causesCopy.none}</p>
      ) : (
        <StatList
          items={causes.map((cause) => ({
            label: chargeCauseLabel(cause.cause),
            detail: causesCopy.detail(formatCount(cause.count, "charge")),
            amount: kes(cause.cents),
            share: formatShare(cause.share),
            width: cause.share ?? 0,
            barTone: "bg-tertiary",
            href: feesDoor(cause.scopeId, importId),
            muted: cause.cause === UNLINKED_CAUSE,
          }))}
        />
      )}
      {areas.length > 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {causesCopy.areas}{" "}
          {areas.map((entry, index) => (
            <span key={entry.id}>
              {index > 0 && ", "}
              <Link href={withImport(entry.href, importId)} className="text-primary font-semibold hover:underline">
                {entry.label}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
    </SectionCard>
  );
}

/**
 * One of the largest charges: the payment it was for, its cause and time,
 * and that payment's amount; a charge not linked to one transaction says so
 * once, as its name. A door to its receipt.
 */
function ChargeRow({ charge, importId }: { charge: ChargeFigure; importId: number | null }) {
  return (
    <Link
      href={feesDoor(charge.scopeId, importId)}
      className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="receipt-badge shrink-0">{charge.receiptNo}</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface truncate">{charge.label ?? largest.notLinked}</span>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums normal-case tracking-normal">
          {charge.label === null ? formatDateTime(charge.time) : `${formatDateTime(charge.time)} • ${chargeCauseLabel(charge.cause)}`}
        </span>
      </div>
      <div className="text-right shrink-0">
        <span className="block font-label-numeric-sm text-label-numeric-sm font-semibold text-tertiary tabular-nums">{kes(charge.cents)}</span>
        {charge.parentCents !== null && (
          <span className="font-label-caps text-label-caps tabular-nums normal-case tracking-normal text-on-surface-variant">{largest.on(kes(charge.parentCents))}</span>
        )}
      </div>
    </Link>
  );
}

/** The largest charges, each with the payment it was for, opening its receipt; then one exit to every charge in Ledger. */
export function LargestChargesCard({ charges, chargeCount, importId }: { charges: ChargeFigure[]; chargeCount: number; importId: number | null }) {
  return (
    <SectionCard
      icon="receipt_long"
      title={largest.title}
      subtitle={largest.subtitle}
      footer={
        chargeCount > 0 ? (
          <Link
            href={feesDoor("fees", importId)}
            className="w-full min-h-11 rounded-lg bg-primary text-on-primary flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-colors"
          >
            {largest.exit(chargeCount)}
            <Icon name="arrow_forward" size={16} />
          </Link>
        ) : undefined
      }
    >
      {charges.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{largest.none}</p>
      ) : (
        <div className="flex flex-col gap-space-xs">
          {charges.map((charge) => (
            <ChargeRow key={`${charge.receiptNo}-${charge.cents}`} charge={charge} importId={importId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** Charges are counted once, on this page; other areas only show them beside their transactions (Q-LINK). */
export function CountedOnceNote() {
  return (
    <NoteCard icon="balance" title={countedOnce.title}>
      <p>{countedOnce.body}</p>
    </NoteCard>
  );
}

/** Payments with no charge on their receipt, out and in: counts only, no doors. */
export function FreeNote({ free }: { free: ShownBreakdown["free"] }) {
  return (
    <NoteCard icon="money_off" title={freeCopy.title}>
      <p>{freeCopy.body(formatCount(free.outCount, "payment"), formatCount(free.inCount, "payment"))}</p>
    </NoteCard>
  );
}

/** What the statement can't show: excise duty is inside each charge, not a line of its own. */
export function ExciseNote() {
  return (
    <NoteCard icon="info" title={excise.title} tone="honest">
      <p>{excise.body}</p>
    </NoteCard>
  );
}
