import Link from "next/link";
import { AreaHeader } from "@/components/analysis/area-header";
import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { NoteCard } from "@/components/analysis/note-card";
import { MONEY_OUT_ON_DARK, Tinted } from "@/components/analysis/tinted";
import { SectionCard } from "@/components/analysis/section-card";
import { StatList } from "@/components/analysis/stat-list";
import { Icon } from "@/components/icon";
import { BREAKDOWN_AREAS } from "@/content/breakdown";
import { agents as agentsCopy, area, cost, deposits, largest, whereCashWent } from "@/content/cash";
import { unverified } from "@/content/overview";
import { formatCount, formatDateTime, formatKes, formatShare } from "@/lib/format";
import { withImport } from "@/lib/import-link";
import { ledgerHref } from "@/lib/ledger-link";
import type { AgentFigure, CashBreakdown, WithdrawalFigure } from "@/lib/statement/cash";

type ShownBreakdown = Extract<CashBreakdown, { status: "shown" }>;

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a Cash door: scope `scopeId`, back to Cash, on import `importId`. */
function cashDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "cash", importId });
}

/**
 * The Cash area's header (IA prototype AreaHeader): the question, the cash
 * withdrawn as a door to every withdrawal, and an answer with the agents and
 * the linked charges (Q-LINK: display only, no door). With no withdrawals the
 * headline is a real KES 0.00 without a door; under T-UNVERIFIED no figure is
 * shown, only R2.2's wording. Shown on the dark card, the charges in money
 * out's amber.
 */
export function CashHeader({ breakdown, importId }: { breakdown: CashBreakdown; importId: number | null }) {
  const header = { label: area.title, question: area.question, figureLabel: area.figureLabel, importId, tone: "dark" as const };
  if (breakdown.status === "unverified") return <AreaHeader {...header} figure="—" answer={<p data-unverified="">{unverified}</p>} />;
  const { total, charges } = breakdown;
  if (total.count === 0) return <AreaHeader {...header} figure={kes(0)} answer={<p>{area.none}</p>} />;
  const figure = (
    <Door href={cashDoor(total.scopeId, importId)} label={`See the ${formatCount(total.count, "withdrawal")} behind ${kes(total.cents)}`} className={DOOR_ON_DARK}>
      {kes(total.cents)}
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
              text={`${area.answer(formatCount(total.count, "withdrawal"), total.agents)}${charges.count > 0 ? area.charges(kes(charges.cents), formatShare(charges.share)) : ""}`}
              marks={charges.count > 0 ? [[kes(charges.cents), MONEY_OUT_ON_DARK]] : []}
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

/** What the statement can't say: what the cash bought, so cash stays out of Spending. */
export function WhereCashWentNote() {
  return (
    <NoteCard icon="visibility_off" title={whereCashWent.title} tone="honest">
      <p>{whereCashWent.body}</p>
    </NoteCard>
  );
}

/** Every agent used (DR-8, the exact stored name), largest first, with its withdrawals and DR-7 share; a door to its withdrawals (no charge on it: Q-LINK). */
export function AgentsCard({ agents, importId }: { agents: AgentFigure[]; importId: number | null }) {
  return (
    <SectionCard icon="storefront" title={agentsCopy.title} subtitle={agentsCopy.subtitle}>
      {agents.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{agentsCopy.none}</p>
      ) : (
        <StatList
          items={agents.map((agent) => ({
            label: agent.label,
            detail: agentsCopy.detail(formatCount(agent.count, "withdrawal")),
            amount: kes(agent.cents),
            share: formatShare(agent.share),
            width: agent.share ?? 0,
            barTone: "bg-tertiary-container",
            href: cashDoor(agent.scopeId, importId),
            muted: agent.label !== agent.entity,
          }))}
        />
      )}
    </SectionCard>
  );
}

/** One of the largest withdrawals: agent, time, principal and linked charge; a door to its receipt. */
function WithdrawalRow({ withdrawal, importId }: { withdrawal: WithdrawalFigure; importId: number | null }) {
  return (
    <Link
      href={cashDoor(withdrawal.scopeId, importId)}
      className="flex items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="receipt-badge shrink-0">{withdrawal.receiptNo}</span>
          <span className="font-body-sm text-body-sm font-semibold text-on-surface truncate">{withdrawal.label}</span>
        </div>
        <span className="font-label-caps text-label-caps text-on-surface-variant tabular-nums normal-case tracking-normal">{formatDateTime(withdrawal.time)}</span>
      </div>
      <div className="text-right shrink-0">
        <span className="block font-label-numeric-sm text-label-numeric-sm font-semibold text-on-surface tabular-nums">-{kes(withdrawal.cents)}</span>
        <span className={withdrawal.chargeCents > 0 ? "charge-pill tabular-nums" : "font-label-caps text-label-caps tabular-nums normal-case tracking-normal text-on-surface-variant"}>
          {withdrawal.chargeCents > 0 ? largest.charge(kes(withdrawal.chargeCents)) : largest.noCharge}
        </span>
      </div>
    </Link>
  );
}

/** The largest withdrawals by principal, each opening its receipt, then one exit to every withdrawal in Ledger. */
export function LargestWithdrawalsCard({ withdrawals, withdrawalCount, importId }: { withdrawals: WithdrawalFigure[]; withdrawalCount: number; importId: number | null }) {
  return (
    <SectionCard
      icon="receipt_long"
      title={largest.title}
      subtitle={largest.subtitle}
      footer={
        withdrawalCount > 0 ? (
          <Link
            href={cashDoor("bucket:cash-withdrawn", importId)}
            className="w-full min-h-11 rounded-lg bg-primary text-on-primary flex items-center justify-center gap-space-xs font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-colors"
          >
            {largest.exit(withdrawalCount)}
            <Icon name="arrow_forward" size={16} />
          </Link>
        ) : undefined
      }
    >
      {withdrawals.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{largest.none}</p>
      ) : (
        <div className="flex flex-col gap-space-xs">
          {withdrawals.map((withdrawal) => (
            <WithdrawalRow key={withdrawal.receiptNo} withdrawal={withdrawal} importId={importId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * What withdrawing cost: the charges linked to withdrawals (Q-LINK), display
 * only and without a door, counted once in Fees, which is linked by its
 * existing screen.
 */
export function WithdrawalCostCard({ charges, importId }: { charges: ShownBreakdown["charges"]; importId: number | null }) {
  const fees = BREAKDOWN_AREAS.find((entry) => entry.id === "fees")?.destination;
  return (
    <SectionCard icon="receipt" title={cost.title}>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {charges.count > 0 ? cost.carried(kes(charges.cents), charges.count) : cost.none}{" "}
        {fees ? (
          <Link href={withImport(fees.href, importId)} className="text-primary font-semibold hover:underline">
            {cost.fees}
          </Link>
        ) : (
          cost.fees
        )}
        .
      </p>
    </SectionCard>
  );
}

/** Cash deposits belong to Money In, linked to its screen on import `importId`. */
export function DepositsNote({ importId }: { importId: number | null }) {
  const moneyIn = BREAKDOWN_AREAS.find((entry) => entry.id === "money-in")?.destination;
  return (
    <NoteCard icon="savings" title={deposits.title}>
      <p>
        {deposits.body}{" "}
        {moneyIn ? (
          <Link href={withImport(moneyIn.href, importId)} className="text-primary font-semibold hover:underline">
            {deposits.link}
          </Link>
        ) : (
          deposits.link
        )}
        {deposits.after}
      </p>
    </NoteCard>
  );
}
