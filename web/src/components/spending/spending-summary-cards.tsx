import { AreaHeader } from "@/components/analysis/area-header";
import { Door, DOOR_ON_DARK } from "@/components/analysis/door";
import { SectionCard } from "@/components/analysis/section-card";
import { StatList } from "@/components/analysis/stat-list";
import { Icon } from "@/components/icon";
import { BUCKET_LABELS } from "@/content/ledger";
import { unverified } from "@/content/overview";
import { area, CHANNEL_COPY, counts, NOT_COUNTED_DETAIL, notCounted as notCountedCopy } from "@/content/spending";
import { formatCount, formatKes, formatShare } from "@/lib/format";
import { ledgerHref } from "@/lib/ledger-link";
import type { SpendingBreakdown } from "@/lib/statement/spending";

type ShownBreakdown = Extract<SpendingBreakdown, { status: "shown" }>;

/** A cents amount as "KES 1,234.00". */
function kes(cents: number) {
  return formatKes(cents / 100);
}

/** The Ledger link of a Spending door: scope `scopeId`, back to Spending, on import `importId`. */
function spendingDoor(scopeId: string, importId: number | null) {
  return ledgerHref({ scopeId, from: "spending", importId });
}

/** The header's answer, light on the dark card: count, DR-9 daily average and DR-7 share of money out, the Q-D1 charges line (amber, as Stitch's charges), the T-DERIVED note. */
function Answer({ breakdown, period }: { breakdown: ShownBreakdown; period: string }) {
  if (breakdown.count === 0) return <p>{area.none(period)}</p>;
  const daily = breakdown.dailyAverageCents === null ? null : kes(breakdown.dailyAverageCents);
  return (
    <div className="flex flex-col gap-space-xs">
      <p>
        {daily ? area.answer(formatCount(breakdown.count, "payment"), period, daily) : null} {area.shareOfOut(formatShare(breakdown.shareOfOut))}
      </p>
      {breakdown.linkedChargeCents > 0 && <p className="font-body-sm text-body-sm text-tertiary-fixed">{area.linkedCharges(kes(breakdown.linkedChargeCents))}</p>}
      {breakdown.unlinkedChargeCount > 0 && <p className="font-body-sm text-body-sm">{area.unlinked(formatCount(breakdown.unlinkedChargeCount, "charge"))}</p>}
      <p className="flex items-center gap-space-2xs font-label-caps text-label-caps text-surface-container-highest/80 normal-case tracking-normal">
        <Icon name="info" size={14} className="text-primary-fixed-dim" />
        {area.derived}
      </p>
    </div>
  );
}

/**
 * The Spending area's header (IA prototype AreaHeader): the question, the
 * principal headline (Q-D1) as a door to the Spending bucket's Ledger scope,
 * and the answer. With no spending the headline is a real KES 0.00 without
 * a door; under T-UNVERIFIED no derived figure is shown, only R2.2's wording.
 * Shown on the dark card (the Stitch Spending KPI banner).
 */
export function SpendingHeader({ breakdown, period, importId }: { breakdown: SpendingBreakdown; period: string; importId: number | null }) {
  if (breakdown.status === "unverified") {
    return <AreaHeader label={area.title} question={area.question} figureLabel={area.figureLabel} figure="—" answer={<p data-unverified="">{unverified}</p>} importId={importId} tone="dark" />;
  }
  const figure =
    breakdown.count > 0 ? (
      <Door href={spendingDoor(breakdown.scopeId, importId)} label={`See the ${formatCount(breakdown.count, "row")} behind ${kes(breakdown.totalCents)}`} className={DOOR_ON_DARK}>
        {kes(breakdown.totalCents)}
      </Door>
    ) : (
      kes(0)
    );
  return <AreaHeader label={area.title} question={area.question} figureLabel={area.figureLabel} figure={figure} answer={<Answer breakdown={breakdown} period={period} />} importId={importId} tone="dark" />;
}

/** What counts as Spending: its channels (M-11), each with its payments, DR-7 share and a door to its channel scope. */
export function ChannelsCard({ breakdown, importId }: { breakdown: ShownBreakdown; importId: number | null }) {
  return (
    <SectionCard icon="check_circle" title={counts.title} subtitle={counts.subtitle}>
      {breakdown.channels.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{counts.empty}</p>
      ) : (
        <StatList
          items={breakdown.channels.map((channel) => ({
            label: CHANNEL_COPY[channel.channel].label,
            detail: `${formatCount(channel.count, "payment")} • ${CHANNEL_COPY[channel.channel].detail}`,
            amount: kes(channel.cents),
            share: formatShare(channel.share),
            width: channel.share ?? 0,
            barTone: CHANNEL_COPY[channel.channel].tone,
            href: spendingDoor(channel.scopeId, importId),
          }))}
        />
      )}
    </SectionCard>
  );
}

/**
 * Not counted as Spending: every other outflow bucket (airtime among them,
 * Q-D2), each with why and a door to its bucket scope; with Spending they
 * make up money out (I-1).
 */
export function NotCountedCard({ notCounted, importId }: { notCounted: ShownBreakdown["notCounted"]; importId: number | null }) {
  return (
    <SectionCard icon="block" title={notCountedCopy.title} subtitle={notCountedCopy.subtitle(kes(notCounted.totalCents))}>
      <StatList
        items={notCounted.items.map((item) => ({
          label: BUCKET_LABELS[item.bucket],
          detail: NOT_COUNTED_DETAIL[item.bucket],
          amount: kes(item.cents),
          href: spendingDoor(item.scopeId, importId),
          muted: true,
        }))}
      />
    </SectionCard>
  );
}
