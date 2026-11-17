// Copy for Overview (IA migration Stage 6): the cards' titles, labels and
// sentences. Every figure comes from the import (lib/statement/overview.ts);
// none is written here.

import type { BucketId } from "@/lib/statement/rows";

export const story = {
  /** "What happened in 1 Jul 2024 – 31 Jul 2024". */
  label: (period: string) => `What happened in ${period}`,
  cameIn: "came into your M-Pesa and",
  wentOut: "went out.",
  /** The sentence after the figures, by the sign of the net flow. */
  higher: "You ended the period",
  higherAfter: "higher, with",
  lower: "You ended the period",
  lowerAfter: "lower, with",
  unchanged: "You ended the period on the same balance it started with:",
  left: "left.",
  /** "Tap … to see the 126 statement lines behind it …" (Q-D5). */
  hint: (lines: string) => `Tap an underlined figure to see the rows behind it among the ${lines}, or follow a section below to see why.`,
};

export const bridge = {
  title: "Cash Flow Bridge",
  tag: "Opening → Closing",
  opening: "Opening balance (calculated)",
  moneyIn: "Money In",
  moneyOut: "Money Out",
  closing: "Closing Balance",
  seeRows: "See rows",
  withheld: "Not confirmed",
  /** O2 disagrees with O1 (U-4): T-UNVERIFIED for the opening value (Q-D6). */
  mismatch: (o1: string, o2: string) =>
    `We can't confirm the opening balance, so it's hidden. Closing balance minus net flow gives ${o1}, but the earliest row's balance gives ${o2}. The other figures come directly from your import.`,
  notChecked: {
    "no-rows": "The opening balance couldn't be checked: this import has no rows.",
    "invalid-time": "The opening balance couldn't be checked against the rows: some rows have a time we can't read.",
    "tied-earliest-time": "The opening balance couldn't be checked against the rows: two or more rows share the earliest time.",
  },
};

/** T-UNVERIFIED wording (plan rev2 R2.2, decision Q-D9). */
export const unverified =
  "We can't confirm that this breakdown adds up to the totals calculated when your statement was imported, so it's hidden. The totals shown come directly from your import.";

export const allocation = {
  title: "Where it went",
  subtitle: "Money out, by what the money did",
  totalLabel: "Money Out",
  empty: "No money went out in this period.",
  why: "Why? Open Breakdown",
};

/** Bar and dot colour of each outflow bucket (IA prototype's allocation palette). */
export const ALLOCATION_SWATCH: Partial<Record<BucketId, string>> = {
  spending: "bg-primary",
  airtime: "bg-primary/60",
  "sent-to-people": "bg-secondary",
  "set-aside": "bg-primary-container",
  "cash-withdrawn": "bg-secondary-container",
  "not-classified-out": "bg-error",
  "reversals-out": "bg-outline",
  "loan-repayments": "bg-outline-variant",
  charges: "bg-tertiary-container",
  "other-out": "bg-surface-container-highest",
};

export const whereFrom = {
  title: "Where it came from",
  subtitle: "Money in, by source",
  totalLabel: "Money In",
  empty: "No money came in during this period.",
  business: "From businesses",
  /** T-PLANNED label (decision Q-P1). */
  planned: "Not available yet",
  businessNote: "Payments from businesses aren't told apart yet; any you received are counted in the sources above.",
  /** The exit to the Money In area (Stage 7f). */
  why: "Why? Open Money In",
};

/** Bar colour of each inflow source. */
export const SOURCE_TONE: Partial<Record<BucketId, string>> = {
  "from-people": "bg-secondary",
  "cash-deposits": "bg-primary-container",
  "reversals-in": "bg-outline",
  "not-classified-in": "bg-error",
  "other-in": "bg-surface-container-highest",
};

export const review = {
  title: "Needs review",
  doneTitle: "Classified",
  /** "3 statement lines couldn't be classified." */
  count: (lines: string) => `${lines} couldn't be classified.`,
  amounts: "They moved",
  explanation: "They count in money in or out but in no area, so Spending doesn't include them.",
  done: "Every statement line was classified.",
  /** U-5 (D-U5): the stored rows differ from the import's count. */
  storedOnce: (stored: string) => `${stored} of them are stored: identical lines on a statement are stored once.`,
  seeRows: (lines: string) => `See the ${lines}`,
  statementCheck: "Statement check",
};

export const events = {
  title: "Largest transactions",
  hint: "Tap a row for its receipt",
  purchase: "Purchase",
  inflow: "Largest money in",
  send: "Largest sent",
  inclCharges: "incl. charges",
  /** "+ KES 7.00 charge". */
  charge: (amount: string) => `+ ${amount} charge`,
  noCharge: "No charge",
  empty: "No transactions to show.",
  open: "Open Ledger",
};

// Dormant Stitch cards (synthesis-card.tsx, insight-tiles.tsx) still import
// the two exports below; neither card is rendered anywhere. Whether to remove
// them is Q-W2 (Stage 8b), so their placeholder copy stays until then.

export const synthesis = {
  label: "Executive Synthesis",
  before: "Between July 1 and July 31, ",
  inflow: "KES 142,500.00",
  middle: " entered your M-Pesa and ",
  outflow: "KES 118,240.00",
  after: " went out, leaving a net cash flow of ",
  net: "+KES 24,260.00",
  leading: { label: "Leading Movement: ", amount: "KES 35,000.00", note: " (Investments)" },
  friction: { label: "Tariff Friction: ", amount: "KES 1,840.00", note: " (1.5%)" },
};

export const insights = {
  topMerchant: { label: "Top Merchant", name: "Naivas Westlands", amount: "KES 16,840.00", detail: "6 checkouts" },
  savingsRate: { label: "Savings Rate", value: "24.6%", detail: "Preserved Inflow", badge: "High discipline" },
  feeDrag: { label: "Fee Drag", amount: "KES 1,840.00", detail: "34 deductions", badge: "1.5% drag" },
};
