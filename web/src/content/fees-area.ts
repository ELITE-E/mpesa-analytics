// Copy for the Fees area of Breakdown (IA migration Stage 7c), "What did
// moving my money cost?". Every figure comes from the import
// (lib/statement/fees.ts); none is written here. Charge-cause labels are the
// Ledger's (content/ledger.ts). The older /fees screen keeps content/fees.ts.

import type { AreaId } from "@/content/breakdown";

export const area = {
  title: "Fees",
  question: "What did moving my money cost?",
  figureLabel: "Charges paid",
  /** "32 charges on 30 of your 79 payments out". */
  answer: (charges: string, charged: number, paymentsOut: number) => `${charges} on ${charged} of your ${paymentsOut} payments out`,
  /** ", 0.4% of money out". */
  shareOfOut: (share: string) => `, ${share} of money out`,
  /** What follows the share when it is shown on its own, coloured (the dark header). */
  shareOfOutAfter: " of money out",
  /** U-2 disagreed (Q-D9, rev2 R2.2): only the share is withheld. */
  shareUnverified:
    "Their share of money out is hidden: we can't confirm the money out adds up to the total calculated when your statement was imported.",
  /** rev2 R1.2 disclosure. */
  unlinked: (charges: string) => `${charges} couldn't be tied to one transaction; they're listed on their own.`,
  none: "No charges in this statement.",
  /** T-UNVERIFIED and T-LOADFAIL: the API's total, shown without a door. */
  apiTotal: (total: string) => `Charges paid: ${total}, as calculated when your statement was imported.`,
  derived: "Calculated from your transactions",
};

/** The bar on the header's dark card (after the Stitch Fees composition bar): money out, split into payments and charges. */
export const composition = {
  title: "Money out, split",
  payments: "Payments",
  /** "Charges 0.4%". */
  charges: (share: string) => `Charges ${share}`,
};

export const causes = {
  title: "What caused the charges",
  subtitle: "Each charge, by the transaction it was charged for. Tap a cause to see its charges.",
  none: "No charges in this statement.",
  /** "2 charges": no other amount sits on a cause's door, which opens exactly its charges. */
  detail: (charges: string) => charges,
  areas: "Each cause belongs to an area:",
};

/** The Breakdown area a cause's transactions belong to, when it has one. */
export const CAUSE_AREA: Partial<Record<string, AreaId>> = {
  TRANSFER_OUT: "people",
  WITHDRAWAL: "cash",
  BILL_PAYMENT: "spending",
  MERCHANT_PAYMENT: "spending",
  BUNDLE_PURCHASE: "spending",
  INVESTMENT: "savings",
};

export const largest = {
  title: "Largest charges",
  subtitle: "The charge and the payment it was for. Each opens the receipt in Ledger.",
  none: "No charges in this statement.",
  /** "on KES 2,000.00". */
  on: (amount: string) => `on ${amount}`,
  notLinked: "Not linked to one transaction",
  /** "See all 32 charges in Ledger"; one charge: "See the charge in Ledger". */
  exit: (count: number) => (count === 1 ? "See the charge in Ledger" : `See all ${count} charges in Ledger`),
};

export const countedOnce = {
  title: "Counted once, here",
  body: "A charge is its own line on the statement. People, Spending, Savings and Cash show the charges on their transactions for context, but only this page counts them.",
};

export const free = {
  title: "Free in this statement",
  /** "12 payments out and 5 payments in carried no charge." */
  body: (out: string, into: string) => `${out} out and ${into} in carried no charge.`,
};

export const excise = {
  title: "Excise duty isn't shown separately",
  body: "Any excise duty is included in the charge itself. The statement doesn't list it on its own line, so it isn't a cause here.",
};
