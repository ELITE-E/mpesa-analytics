import Link from "next/link";
import { AreaHeader } from "@/components/analysis/area-header";
import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { NoteCard } from "@/components/analysis/note-card";
import { MONEY_IN_ON_DARK, Tinted } from "@/components/analysis/tinted";
import { SectionCard } from "@/components/analysis/section-card";
import { StatList } from "@/components/analysis/stat-list";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS } from "@/content/breakdown";
import { BUCKET_LABELS } from "@/content/ledger";
import { area, business, largest, months, sources as sourcesCopy } from "@/content/money-in";
import { SOURCE_TONE, unverified } from "@/content/overview";
import { formatCount, formatDateTime, formatKes, formatShare } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { MoneyInFigures, PaymentFigure, SourceFigure } from "@/lib/statement/money-in";

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a Money In door: scope `scopeId`, back to Money In, on import `importId`. */
function moneyInDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "money-in", importId });
}

/**
 * The Money In area's header (IA prototype AreaHeader): the question, the
 * API's money in as a door to every inflow row, and an answer with the
 * payments and the largest source's DR-7 share. Without rows (T-LOADFAIL) or
 * under T-UNVERIFIED the API's total stays, without a door (R2.2's wording
 * for the latter); with no money in it says so, over a real KES 0.00. Shown
 * on the dark card, money in's amount and the source's share in its green.
 */
export function MoneyInHeader({ api, breakdown, importId }: Pick<MoneyInFigures, "api" | "breakdown"> & { importId: number | null }) {
  const header = { label: area.title, question: area.question, figureLabel: area.figureLabel, importId, tone: "dark" as const };
  if (!breakdown || breakdown.status === "unverified") {
    return (
      <AreaHeader
        {...header}
        figure={kes(api.cents)}
        answer={
          <div className="flex flex-col gap-space-xs">
            <p>
              <Tinted text={area.apiTotal(kes(api.cents))} marks={[[kes(api.cents), MONEY_IN_ON_DARK]]} />
            </p>
            {breakdown && <p data-unverified="">{unverified}</p>}
          </div>
        }
      />
    );
  }
  if (breakdown.count === 0) return <AreaHeader {...header} figure={kes(0)} answer={<p>{area.none}</p>} />;
  const top = breakdown.sources.reduce<SourceFigure | null>((best, source) => (best === null || source.cents > best.cents ? source : best), null);
  const figure = (
    <Door href={moneyInDoor(api.scopeId, importId)} label={`See the ${formatCount(breakdown.count, "payment")} behind ${kes(api.cents)}`} className={DOOR_ON_DARK}>
      {kes(api.cents)}
    </Door>
  );
  return (
    <AreaHeader
      {...header}
      figure={figure}
      answer={
        <div className="flex flex-col gap-space-xs">
          <p>
            <Tinted
              text={`${area.answer(formatCount(breakdown.count, "payment"))}${top ? area.largestSource(BUCKET_LABELS[top.bucket], formatShare(top.share)) : ""}`}
              marks={top ? [[formatShare(top.share), MONEY_IN_ON_DARK]] : []}
            />
          </p>
          <p className="flex items-center gap-space-2xs font-label-caps text-label-caps text-surface-container-highest/80 normal-case tracking-normal">
            <Icon name="info" size={14} className="text-primary-fixed-dim" />
            {area.derived}
          </p>
        </div>
      }
    />
  );
}

/** Money in by source (DR-6), each with its rows, DR-7 share and a door to its bucket; People is linked for who sent money. */
export function SourcesCard({ sources, importId }: { sources: SourceFigure[]; importId: number | null }) {
  const people = BREAKDOWN_AREAS.find((entry) => entry.id === "people")?.destination;
  return (
    <SectionCard icon="south_west" title={sourcesCopy.title} subtitle={sourcesCopy.subtitle}>
      {sources.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{sourcesCopy.none}</p>
      ) : (
        <StatList
          items={sources.map((source) => ({
            label: BUCKET_LABELS[source.bucket],
            detail: formatCount(source.count, "payment"),
            amount: kes(source.cents),
            share: formatShare(source.share),
            width: source.share ?? 0,
            barTone: SOURCE_TONE[source.bucket],
            href: moneyInDoor(source.scopeId, importId),
          }))}
        />
      )}
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {sourcesCopy.people}{" "}
        {people ? (
          <Link href={withImport(people.href, importId)} className="text-primary font-semibold hover:underline">
            {sourcesCopy.peopleLink}
          </Link>
        ) : (
          sourcesCopy.peopleLink
        )}
        .
      </p>
    </SectionCard>
  );
}

/** One of the largest payments in: who, its source, when, the principal and any linked charge; a door to its receipt. */
function PaymentRow({ payment, importId }: { payment: PaymentFigure; importId: number | null }) {
  return (
    <Link
      href={moneyInDoor(payment.scopeId, importId)}
      className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="receipt-badge shrink-0">{payment.receiptNo}</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface truncate">{payment.label}</span>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums normal-case tracking-normal">
          {formatDateTime(payment.time)} • {BUCKET_LABELS[payment.bucket]}
        </span>
      </div>
      <div className="text-right shrink-0">
        <span className="block font-label-numeric-sm text-label-numeric-sm font-semibold text-primary tabular-nums">{`+${kes(payment.cents)}`}</span>
        {payment.chargeCents > 0 && (
          <span className="charge-pill tabular-nums">{largest.charge(kes(payment.chargeCents))}</span>
        )}
      </div>
    </Link>
  );
}

/** The largest payments in by principal, each opening its receipt, then one exit to every inflow row in Ledger. */
export function LargestPaymentsCard({ payments, paymentCount, importId }: { payments: PaymentFigure[]; paymentCount: number; importId: number | null }) {
  return (
    <SectionCard
      icon="receipt_long"
      title={largest.title}
      subtitle={largest.subtitle}
      footer={
        paymentCount > 0 ? (
          <Link
            href={moneyInDoor("money-in", importId)}
            className="w-full min-h-11 rounded-lg bg-primary text-on-primary flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-colors"
          >
            {largest.exit(paymentCount)}
            <Icon name="arrow_forward" size={16} />
          </Link>
        ) : undefined
      }
    >
      {payments.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{largest.none}</p>
      ) : (
        <div className="flex flex-col gap-space-xs">
          {payments.map((payment) => (
            <PaymentRow key={payment.receiptNo} payment={payment} importId={importId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** What the engine can't tell yet: payments from businesses, and whether one is a salary. */
export function BusinessNote() {
  return (
    <NoteCard icon="corporate_fare" title={business.title} tone="honest">
      <p>{business.body}</p>
      <p>{business.income}</p>
    </NoteCard>
  );
}

/** Comparing months needs more than one statement: a T-PLANNED note (Q-P1 label), no figure and no link. */
export function MonthsNote() {
  return (
    <NoteCard icon="calendar_month" title={months.title} planned={months.planned}>
      <p>{months.body}</p>
    </NoteCard>
  );
}
