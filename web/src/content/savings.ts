// Copy for the Savings & Investments area (IA migration Stage 7d), "How much
// did I set aside?". Every figure comes from the import
// (lib/statement/savings.ts); none is written here.

export const area = {
  title: "Savings & Investments",
  question: "How much did I set aside?",
  figureLabel: "Set aside",
  /** "4 deposits into 2 places". */
  deposits: (deposits: string, places: number) => `${deposits} into ${places} ${places === 1 ? "place" : "places"}`,
  /** DR-7 share of money in: ", 47.5% of the money that came in". */
  shareOfIn: (share: string) => `, ${share} of the money that came in`,
  /** What follows the share when it is shown on its own, coloured (the dark header). */
  shareOfInAfter: " of the money that came in",
  notSpending: "None of it is counted as spending.",
  /** U-1 disagreed (Q-D9, rev2 R2.2): only the share is withheld. */
  shareUnverified:
    "Its share of the money that came in is hidden: we can't confirm the money in adds up to the total calculated when your statement was imported.",
  none: "You didn't set any money aside in this statement.",
  /** T-UNVERIFIED: the API's total, shown without a door. */
  apiTotal: (total: string) => `Set aside: ${total}, as calculated when your statement was imported.`,
  derived: "Calculated from your transactions",
};

/** The split bar on the header's dark card (after the Stitch Investments gauge): how the total divides across places. */
export const split = {
  title: "How it splits",
  /** Places beyond the first three, grouped. */
  others: "Other places",
};

export const notSpending = {
  title: "Set aside, not spent",
  body: "Money moved into a savings or investment product is still yours: it changed place, it wasn't consumed. So it is never counted as Spending.",
};

export const places = {
  title: "Where it went",
  subtitle: "Grouped by the name on the statement. Tap a place to see its deposits.",
  none: "No money was set aside in this statement.",
  /** "2 deposits". */
  detail: (deposits: string) => deposits,
};

export const months = {
  title: "When you set money aside",
  subtitle: "Deposits by calendar month.",
  unreadable: "Time not readable",
};

export const largest = {
  title: "Largest deposits",
  subtitle: "Each opens the receipt in Ledger.",
  none: "No money was set aside in this statement.",
  /** "See all 4 deposits in Ledger"; one deposit: "See the deposit in Ledger". */
  exit: (count: number) => (count === 1 ? "See the deposit in Ledger" : `See all ${count} deposits in Ledger`),
  charge: (amount: string) => `+ ${amount} charge`,
  noCharge: "No charge",
  /** Q-LINK, display only. */
  carried: (amount: string, deposits: number) =>
    `Deposits carried ${amount} in charges across ${deposits} ${deposits === 1 ? "deposit" : "deposits"}. They are counted once, in`,
  noCharges: "No charges were linked to your deposits. Charges are counted in",
  fees: "Fees",
};

export const limits = {
  title: "What this statement can't show",
  balances: "Balances, growth and withdrawals inside these products aren't on an M-Pesa statement, so nothing here estimates them.",
  recognised: "Today only unit-trust deposits are recognised as set aside. A money market fund paid by Paybill counts as a bill in Spending, and M-Shwari as not yet classified.",
};

export const otherSavings = {
  title: "Other savings products",
  /** T-PLANNED label (decision Q-P1). */
  planned: "Not available yet",
  body: "Recognising money market funds, M-Shwari and other savings products needs a list of known savings accounts, which the engine doesn't have yet.",
};
