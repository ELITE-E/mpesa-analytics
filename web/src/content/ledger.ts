// Copy for the Ledger (IA migration Stage 5). Bucket names are the DR-3 table's
// (plan rev1 §1.3; Q-D2, Q-D3 and Q-D10 approved): what each row counts as.

import type { BucketId } from "@/lib/statement/rows";

/** What a row counts as, by its DR-3 bucket. */
export const BUCKET_LABELS: Record<BucketId, string> = {
  spending: "Spending",
  airtime: "Airtime",
  "sent-to-people": "Sent to people",
  "set-aside": "Set aside",
  "cash-withdrawn": "Cash withdrawn",
  "not-classified-out": "Not yet classified",
  "reversals-out": "Reversals (money out)",
  "loan-repayments": "Loan repayments",
  charges: "Charges",
  "other-out": "Other money out",
  "from-people": "From people",
  "cash-deposits": "Cash deposits",
  "reversals-in": "Reversals (money in)",
  "not-classified-in": "Not yet classified (in)",
  "other-in": "Other money in",
};

/** Icon and tile tone of each bucket, after the IA prototype's kinds. */
export const BUCKET_STYLE: Record<BucketId, { icon: string; tone: string }> = {
  spending: { icon: "shopping_bag", tone: "bg-surface-container text-on-surface-variant" },
  airtime: { icon: "phone_iphone", tone: "bg-surface-container text-on-surface-variant" },
  "sent-to-people": { icon: "north_east", tone: "bg-secondary-container text-on-secondary-fixed-variant" },
  "set-aside": { icon: "trending_up", tone: "bg-primary-container text-on-primary" },
  "cash-withdrawn": { icon: "local_atm", tone: "bg-tertiary-fixed/40 text-on-tertiary-fixed-variant" },
  "not-classified-out": { icon: "help", tone: "bg-error-container text-on-error-container" },
  "reversals-out": { icon: "undo", tone: "bg-surface-container text-on-surface-variant" },
  "loan-repayments": { icon: "credit_card", tone: "bg-surface-container text-on-surface-variant" },
  charges: { icon: "receipt", tone: "bg-tertiary-fixed/40 text-on-tertiary-fixed-variant" },
  "other-out": { icon: "more_horiz", tone: "bg-surface-container text-on-surface-variant" },
  "from-people": { icon: "south_west", tone: "bg-primary/10 text-primary" },
  "cash-deposits": { icon: "savings", tone: "bg-primary/10 text-primary" },
  "reversals-in": { icon: "undo", tone: "bg-primary/10 text-primary" },
  "not-classified-in": { icon: "help", tone: "bg-error-container text-on-error-container" },
  "other-in": { icon: "more_horiz", tone: "bg-primary/10 text-primary" },
};

/** Title and question of the named scopes (decision Q-R2). */
export const NAMED_SCOPE_COPY: Record<string, { title: string; question: string }> = {
  unclassified: { title: "Not yet classified", question: "Which rows couldn't be classified?" },
  fees: { title: "Charges", question: "What did moving my money cost?" },
  investments: { title: "Investments", question: "How much did I put into investments?" },
  "money-in": { title: "Money in", question: "What came into my M-Pesa?" },
  "money-out": { title: "Money out", question: "What went out of my M-Pesa, charges included?" },
};

/** The question of a bucket scope (DR-5, DR-6): which rows count as `label`. */
export const bucketQuestion = (label: string) => `Which rows count as ${label}?`;

/**
 * What caused a charge (Stage 7c, decision Q-D7): the kind of transaction it
 * was charged for, by `event_type`, or "unlinked" for a charge not tied to
 * one transaction. Any other type reads as "Other transactions".
 */
export const CHARGE_CAUSE_LABELS: Record<string, string> = {
  TRANSFER_OUT: "Sending money",
  WITHDRAWAL: "Cash withdrawals",
  BILL_PAYMENT: "Paybill payments",
  MERCHANT_PAYMENT: "Till payments",
  BUNDLE_PURCHASE: "Data bundles",
  AIRTIME_PURCHASE: "Airtime",
  INVESTMENT: "Savings deposits",
  LOAN_REPAYMENT: "Loan repayments",
  REVERSAL: "Reversals",
  UNCLASSIFIED: "Transactions not yet classified",
  TRANSFER_IN: "Money received",
  DEPOSIT: "Cash deposits",
  unlinked: "Charges not linked to one transaction",
};

/** The label of charge cause `cause`. */
export const chargeCauseLabel = (cause: string) => CHARGE_CAUSE_LABELS[cause] ?? "Other transactions";

/** The question of a charge-cause scope (Stage 7c). */
export const chargeCauseQuestion = (cause: string) =>
  cause === "unlinked" ? "Which charges couldn't be tied to one transaction?" : `What did ${chargeCauseLabel(cause).toLowerCase()} cost in charges?`;

/** The question of a Spending channel scope (Stage 7a): which payments went through `label`. */
export const channelQuestion = (label: string) => `Which spending went through ${label}?`;

export const ledger = {
  allTitle: "Every row, with what it counts as",
  allDescription:
    "Charges are separate lines on the statement; here each one sits on the transaction it was charged for when the receipt shows which one, so it is counted once. Tap a row for its receipt.",
  receiptQuestion: "What exactly happened in this transaction?",
  unrecognised: "That view isn't available here, so every row is shown.",
  noRows: "No rows: this is a real KES 0.00 on this statement, not a missing value.",
  noMatches: "No rows match.",
  unlinkedLabel: "Charge not linked to one transaction",
  /** A row whose entity the engine could not identify (src/entity.py's NO_ENTITY_IDENTIFIED). */
  notIdentified: "Not identified",
  orphanDetail: "No matching transaction on this statement",
  /** "Shared by N transactions on this receipt". */
  ambiguousDetail: (count: number) => `Shared by ${count} transactions on this receipt`,
  linkedElsewhere: "Charged for the transaction on this receipt",
  dialogTitle: "Receipt",
  close: "Close",
  showAll: "Show all rows",
  searchLabel: "Search receipt, name or statement text",
  densityLabel: "Row density",
};

/** Shown with every CSV export (CP10a item 3): the file leaves the app's lock behind. */
export const exportNotice = "The CSV file is not encrypted: anyone who has the file can read it.";
