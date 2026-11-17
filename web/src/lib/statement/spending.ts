// The Spending area's figures (IA migration Stage 7a), composed from the
// Stage 4b statement model and the API's recurring lists, each with the
// Ledger scope its door opens (DR-10, I-4). Decisions: Q-D1 (principal
// headline, linked charges display only, merchants by principal, no API
// total-cost figure), Q-D2 (airtime apart), Q-D9 (T-LOADFAIL, T-UNVERIFIED).
// Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { linkCharges, linkedChargesByParent, summarizeCharges } from "@/lib/statement/charges";
import { groupsInBucket } from "@/lib/statement/groups";
import { toCents, type BucketId, type StatementRow } from "@/lib/statement/rows";
import { SPENDING_CHANNELS, type SpendingChannel } from "@/lib/statement/scopes";
import { compareWithApi, dailyAverageCents, outflowAllocation, share } from "@/lib/statement/totals";

/** One Spending channel (M-11): its principal, payment count, DR-7 share of Spending and scope. */
export type ChannelFigure = { channel: SpendingChannel; cents: number; count: number; share: number | null; scopeId: string };

/** One merchant (DR-8 group of the Spending bucket), ranked by principal. */
export type MerchantFigure = {
  rank: number;
  entity: string;
  /** "Not identified" for the engine's no-entity marker. */
  label: string;
  cents: number;
  count: number;
  /** DR-7 share of Spending. */
  share: number | null;
  /** DR-7 share of the top merchant, for the bar. */
  barShare: number | null;
  scopeId: string;
};

/** The derived Spending figures, or withheld when the rows disagree with the API's totals (T-UNVERIFIED). */
export type SpendingBreakdown =
  | {
      status: "shown";
      totalCents: number;
      count: number;
      scopeId: string;
      /** DR-9, unrounded cents; null for an invalid period. */
      dailyAverageCents: number | null;
      /** Money out from the rows (equal to the API's when shown). */
      moneyOutCents: number;
      /** DR-7 share of money out. */
      shareOfOut: number | null;
      /** Charges linked to spending rows (Q-LINK, display only; counted in Fees). */
      linkedChargeCents: number;
      /** Charges on the statement not linked to one transaction (rev2 R1.2 disclosure). */
      unlinkedChargeCount: number;
      channels: ChannelFigure[];
      notCounted: { totalCents: number; items: { bucket: BucketId; cents: number; scopeId: string }[] };
      merchants: { groupCount: number; items: MerchantFigure[] };
    }
  | { status: "unverified" };

/** One receipt in the preview: a spending row as stored. */
export type ReceiptPreview = {
  receiptNo: string;
  label: string;
  /** The completion time as the statement states it. */
  time: string;
  channel: SpendingChannel;
  cents: number;
  balanceCents: number;
  scopeId: string;
};

/** The receipt preview: "all" and one filter per top merchant, each with its most recent receipts. */
export type ReceiptPreviewSet = {
  filters: { id: string; label: string | null; count: number }[];
  previews: Record<string, ReceiptPreview[]>;
};

/** A recurring purchase or bill as the API lists it (M-13), opening its merchant's spending rows. */
export type RecurringFigure = { kind: "purchase" | "bill"; name: string; occurrences: number; dates: string[]; scopeId: string };

export type SpendingFigures = {
  /** null without rows (T-LOADFAIL). */
  breakdown: SpendingBreakdown | null;
  /** null without rows; kept under T-UNVERIFIED (rows as stored). */
  receipts: ReceiptPreviewSet | null;
  /** API values: always available. */
  recurring: RecurringFigure[];
};

/** Merchants listed on the page (IA prototype: top 5). */
const MERCHANTS_SHOWN = 5;
/** Receipts per preview, and merchants with a preview filter (IA prototype). */
const RECEIPTS_SHOWN = 3;
const RECEIPT_FILTERS = 3;

/** The channel of a spending row: the SPENDING_CHANNELS entry of its event type. */
function channelOf(row: StatementRow) {
  return (Object.keys(SPENDING_CHANNELS) as SpendingChannel[]).find((channel) => SPENDING_CHANNELS[channel] === row.eventType) as SpendingChannel;
}

/** M-11: Spending by channel, in SPENDING_CHANNELS order, channels without payments left out. */
function channelsOf(spending: StatementRow[], totalCents: number): ChannelFigure[] {
  return (Object.keys(SPENDING_CHANNELS) as SpendingChannel[])
    .map((channel) => {
      const members = spending.filter((row) => channelOf(row) === channel);
      const cents = members.reduce((total, row) => total + row.principalCents, 0);
      return { channel, cents, count: members.length, share: share(cents, totalCents), scopeId: `spending:${channel}` };
    })
    .filter((channel) => channel.count > 0);
}

/** DR-8: the Spending bucket's merchants by principal, largest first (ties keep statement order), the top MERCHANTS_SHOWN. */
function merchantsOf(rows: StatementRow[], totalCents: number) {
  const groups = [...groupsInBucket(rows, "spending")].sort((a, b) => b.cents - a.cents);
  const topCents = groups[0]?.cents ?? 0;
  return {
    groupCount: groups.length,
    items: groups.slice(0, MERCHANTS_SHOWN).map((group, index) => ({
      rank: index + 1,
      entity: group.entity,
      label: group.label,
      cents: group.cents,
      count: group.rowIds.length,
      share: share(group.cents, totalCents),
      barShare: share(group.cents, topCents),
      scopeId: `group:spending:${group.entity}`,
    })),
  };
}

/** The most recent RECEIPTS_SHOWN of `rows` (statement order), newest first, as previews. */
function recentReceipts(rows: StatementRow[], labels: Map<string, string>): ReceiptPreview[] {
  return rows
    .slice(-RECEIPTS_SHOWN)
    .reverse()
    .map((row) => ({
      receiptNo: row.receiptNo,
      label: labels.get(row.entity) ?? row.entity,
      time: row.source.completion_time,
      channel: channelOf(row),
      cents: row.principalCents,
      balanceCents: toCents(row.source.balance),
      scopeId: `receipt:${row.receiptNo}`,
    }));
}

/** M-14: the most recent spending receipts, overall and for each of the top RECEIPT_FILTERS merchants. */
function receiptsOf(rows: StatementRow[], spending: StatementRow[], merchants: MerchantFigure[]): ReceiptPreviewSet {
  const labels = new Map(groupsInBucket(rows, "spending").map((group) => [group.entity, group.label]));
  const top = merchants.slice(0, RECEIPT_FILTERS);
  const previews: Record<string, ReceiptPreview[]> = { all: recentReceipts(spending, labels) };
  for (const merchant of top) previews[merchant.entity] = recentReceipts(spending.filter((row) => row.entity === merchant.entity), labels);
  return {
    filters: [{ id: "all", label: null, count: spending.length }, ...top.map((merchant) => ({ id: merchant.entity, label: merchant.label, count: merchant.count }))],
    previews,
  };
}

/** M-13: the API's recurring purchases, then its recurring bills, each opening its merchant's spending rows. */
function recurringOf(analytics: AnalyticsResult): RecurringFigure[] {
  return [
    ...analytics.spending.recurring_purchases.map((item) => ({ kind: "purchase" as const, name: item.merchant, occurrences: item.occurrences, dates: item.dates })),
    ...analytics.bills.recurring_bills.map((item) => ({ kind: "bill" as const, name: item.bill, occurrences: item.occurrences, dates: item.dates })),
  ].map((item) => ({ ...item, scopeId: `group:spending:${item.name}` }));
}

/**
 * Every figure the Spending area shows for one import. Without rows (still
 * loading, or failed: T-LOADFAIL) only the API's recurring lists remain.
 * With rows, the derived figures are withheld when the rows' outflow or
 * charges disagree with the API's (U-2, U-3: T-UNVERIFIED); the receipt
 * previews, rows as stored, stay.
 */
export function spendingFigures({ summary, analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): SpendingFigures {
  const recurring = recurringOf(analytics);
  if (rows === null) return { breakdown: null, receipts: null, recurring };

  const spending = rows.filter((row) => row.bucket === "spending");
  const allocation = outflowAllocation(rows);
  const totalCents = allocation.find((bucket) => bucket.bucket === "spending")?.cents ?? 0;
  const merchants = merchantsOf(rows, totalCents);
  const receipts = receiptsOf(rows, spending, merchants.items);
  const comparison = compareWithApi(rows, analytics);
  if (!comparison.outflow.agrees || !comparison.charges.agrees) return { breakdown: { status: "unverified" }, receipts, recurring };

  const links = linkCharges(rows);
  const chargesByParent = linkedChargesByParent(rows, links);
  const moneyOutCents = allocation.reduce((total, bucket) => total + bucket.cents, 0);
  const others = allocation.filter((bucket) => bucket.bucket !== "spending");
  return {
    breakdown: {
      status: "shown",
      totalCents,
      count: spending.length,
      scopeId: "bucket:spending",
      dailyAverageCents: dailyAverageCents(totalCents, summary.period_start, summary.period_end),
      moneyOutCents,
      shareOfOut: share(totalCents, moneyOutCents),
      linkedChargeCents: spending.reduce((total, row) => total + (chargesByParent.get(row.id) ?? 0), 0),
      unlinkedChargeCount: summarizeCharges(rows, links).unlinkedCount,
      channels: channelsOf(spending, totalCents),
      notCounted: {
        totalCents: others.reduce((total, bucket) => total + bucket.cents, 0),
        items: others.map((bucket) => ({ bucket: bucket.bucket, cents: bucket.cents, scopeId: `bucket:${bucket.bucket}` })),
      },
      merchants,
    },
    receipts,
    recurring,
  };
}
