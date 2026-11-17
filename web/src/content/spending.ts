// Copy for the Spending area (IA migration Stage 7a), "What did I consume?".
// Every figure comes from the import (lib/statement/spending.ts); none is
// written here, except in the dormant Stitch cards' section at the end.

import type { BucketId } from "@/lib/statement/rows";
import type { SpendingChannel } from "@/lib/statement/scopes";

export const area = {
  title: "Spending",
  question: "What did I consume?",
  breadcrumb: "Breakdown",
  figureLabel: "Spending",
  /** "94 payments for goods, bills and data in 1 Jul 2024 – 31 Jul 2024, about KES 1,234.56 a day." */
  answer: (payments: string, period: string, daily: string) => `${payments} for goods, bills and data in ${period}, about ${daily} a day.`,
  shareOfOut: (share: string) => `That's ${share} of everything that went out.`,
  none: (period: string) => `No payments for goods, bills or data in ${period}.`,
  derived: "Calculated from your transactions",
  /** Q-D1: the charges linked to spending payments, display only. */
  linkedCharges: (amount: string) => `Charges linked to these payments: ${amount}, counted in Fees, not here.`,
  /** rev2 R1.2: charges that can't be tied to one transaction. */
  unlinked: (count: string) => `${count} on this statement can't be linked to one transaction; Fees shows them.`,
};

export const counts = {
  title: "What counts as spending",
  subtitle: "Payments for something you used. Tap a figure to see its rows.",
  empty: "No spending in this statement.",
};

/** Label and description of each Spending channel (M-11). */
export const CHANNEL_COPY: Record<SpendingChannel, { label: string; detail: string; tone: string }> = {
  till: { label: "Buy Goods tills", detail: "Shops, fuel and food", tone: "bg-primary" },
  paybill: { label: "Paybill", detail: "Rides and household bills", tone: "bg-secondary" },
  bundle: { label: "Data bundles", detail: "Bought for your own line", tone: "bg-primary-container" },
};

export const notCounted = {
  title: "Not counted as spending",
  /** "KES 50,000.00 of money out is kept out of this total, on purpose." */
  subtitle: (amount: string) => `${amount} of money out is kept out of this total, on purpose.`,
};

/** Why each other outflow bucket isn't Spending (Q-D2 for airtime). */
export const NOT_COUNTED_DETAIL: Partial<Record<BucketId, string>> = {
  airtime: "Bought for your line; not counted in Spending",
  "sent-to-people": "Purpose unknown: rent, family, a loan?",
  "set-aside": "Savings and investments are kept, not spent",
  "cash-withdrawn": "What the cash bought isn't on the statement",
  "not-classified-out": "Kept out until reviewed",
  "reversals-out": "Money returned, not consumed",
  "loan-repayments": "Repaying a loan isn't consumption",
  "other-out": "Didn't fit a category",
  charges: "Shown in Fees, so they're never counted twice",
};

export const rankedSection = {
  title: "Where your spending went",
  subtitle: "Top 5 merchants and billers by value",
  sortLabel: "BY VALUE",
  empty: "No merchants paid in this statement.",
  /** "6 payments". */
  count: (payments: string) => payments,
};

export const utilitiesSection = {
  title: "Recurring payments",
  subtitle: "Merchants and bills paid at regular intervals, as found when your statement was imported.",
  /** T-PARTIAL: what the list can't show yet (M-13). */
  partial: "A pattern needs at least three payments at regular intervals, so one statement may not show it.",
  none: "None found yet.",
  purchase: "Purchase",
  bill: "Bill",
  seeRows: "See its rows",
};

export const receiptsSection = {
  label: "Evidence",
  title: "Recent spending receipts",
  allFilter: "All",
  /** "See all 94 spending rows in Ledger". */
  cta: (count: number) => `See all ${count} spending rows in Ledger`,
  emptyPreview: "No spending receipts to preview.",
  filterLabel: "Show receipts for",
};

// Dormant Stitch cards (spending-scope-card, channel-split-card,
// audit-banner, behavioral-diagnostic-card) still import the exports below;
// none of them is rendered. Whether to remove them is Q-W2 (Stage 8b), so
// their placeholder copy stays until then.

export type Channel = {
  label: string;
  shortLabel: string;
  badge: string;
  /** Badge colours. */
  badgeTone: string;
  description: string;
  icon: string;
  iconTone: string;
  amount: string;
  share: string;
  width: number;
  swatch: string;
  shareTone: string;
};

export const scope = {
  label: "Audit Scope: Consumption Outflow",
  exclusion: "Excl. P2P & Capital",
  total: "KES 62,900.00",
  eventsNote: "94 Verified Outflow Events in July 2024",
  metrics: [
    { label: "Daily Burn", value: "KES 2,029.03", isFriction: false },
    { label: "Tariff Drag", value: "KES 782.00 (1.2%)", isFriction: true, href: "/fees" },
    { label: "Peak Spend Day", value: "14th July (KSh 11.2k)", isFriction: false },
  ],
};

export const channelSplit = {
  title: "Outflow Channel Split",
  badge: "3 CHANNELS",
};

export const channels: Channel[] = [
  {
    label: "Buy Goods (Till)",
    shortLabel: "Till",
    badge: "Zero User Fee",
    badgeTone: "bg-primary/10 text-primary",
    description: "Merchant in-store QR & Till settlements",
    icon: "storefront",
    iconTone: "text-primary",
    amount: "KES 31,450.00",
    share: "50.0%",
    width: 50.0,
    swatch: "bg-primary",
    shareTone: "text-primary",
  },
  {
    label: "Paybill Merchants",
    shortLabel: "Paybill",
    badge: "Tariff Tracked",
    badgeTone: "bg-secondary/15 text-secondary",
    description: "Utilities, accounts & commercial paybills",
    icon: "receipt",
    iconTone: "text-secondary",
    amount: "KES 26,850.00",
    share: "42.7%",
    width: 42.7,
    swatch: "bg-secondary",
    shareTone: "text-secondary",
  },
  {
    label: "Agent Cash Out",
    shortLabel: "Cash Out",
    badge: "Band 3 Fee",
    badgeTone: "bg-tertiary-fixed text-on-tertiary-fixed",
    description: "Safaricom Sub-Agent branch withdrawals",
    icon: "local_atm",
    iconTone: "text-tertiary",
    amount: "KES 4,600.00",
    share: "7.3%",
    width: 7.3,
    swatch: "bg-tertiary-container",
    shareTone: "text-tertiary",
  },
];

export const auditBanner = {
  // Stage 8b (C-18): no tariff table or SMS alerts are read, so no reconciliation is claimed.
  label: "Statement check",
  title: "Charges as your statement shows them",
  description: "Charges aren't compared with a published tariff table or with SMS alerts.",
  imageAlt:
    "Close up archival document view of Kenyan high-denomination banknotes with tabular audited receipt numbers and green ledgers.",
};

export const diagnostic = {
  label: "Behavioral Diagnostic",
  title: "High Frequency vs. High Impact",
  narrative: {
    before: "Bolt urban mobility exhibits micro-ticket attrition (11 rides averaging ",
    frequentAverage: "KES 444.55",
    middle:
      "), yielding subtle cumulative drag. In contrast, Shell Fuel represents low-frequency macro-impact (3 events averaging ",
    impactfulAverage: "KES 3,133.33",
    after: ").",
  },
  stats: [
    { label: "Volume Velocity", value: "11", unit: "events / mo", subject: "BOLT COMMUTE", subjectTone: "text-secondary" },
    { label: "Capital Weight", value: "7.1x", unit: "ticket ratio", subject: "SHELL LOGISTICS", subjectTone: "text-primary" },
  ],
};
