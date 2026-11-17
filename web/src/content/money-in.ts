// Copy for the Money In area (IA migration Stage 7f), "Where did my money
// come from?". Every figure comes from the import
// (lib/statement/money-in.ts); none is written here.

export const area = {
  title: "Money In",
  question: "Where did my money come from?",
  figureLabel: "Money in",
  /** "14 payments came in." */
  answer: (payments: string) => `${payments} came in.`,
  /** " The largest source, From people, brought 52.6% of it." */
  largestSource: (label: string, share: string) => ` The largest source, ${label}, brought ${share} of it.`,
  none: "No money came in during this statement.",
  /** T-UNVERIFIED and T-LOADFAIL: the API's total, shown without a door. */
  apiTotal: (total: string) => `Money in: ${total}, as calculated when your statement was imported.`,
  derived: "Calculated from your transactions",
};

export const sources = {
  title: "Where it came from",
  subtitle: "Money in, by source. Tap a source to see its rows.",
  none: "No money came in during this statement.",
  /** People has its own screen: who sent money and what went back. */
  people: "Who sent you money, and what you sent back, is in",
  peopleLink: "People",
};

export const largest = {
  title: "Largest payments in",
  subtitle: "Each opens the receipt in Ledger.",
  none: "No money came in during this statement.",
  /** "See all 14 payments in Ledger"; one payment: "See the payment in Ledger". */
  exit: (count: number) => (count === 1 ? "See the payment in Ledger" : `See all ${count} payments in Ledger`),
  charge: (amount: string) => `+ ${amount} charge`,
};

export const business = {
  title: "Business payments aren't recognised yet",
  body: "The engine has no rule for payments from businesses, so any you received are counted in Not yet classified (in) until they're reviewed.",
  income: "The statement also can't tell a salary from any other business payment, so nothing here is labelled income.",
};

export const months = {
  title: "Comparing months",
  /** T-PLANNED label (decision Q-P1). */
  planned: "Not available yet",
  body: "Comparing money in across months needs two or more statements analysed together.",
};
