// Copy for the People area (IA migration Stage 7b), "How much money moved
// between me and other people?". Every figure comes from the import
// (lib/statement/people.ts); none is written here.

export const area = {
  title: "People",
  question: "How much money moved between me and other people?",
  figureLabel: "Sent to people",
  /** "You sent KES 18,500.00 to 6 people and received KES 52,500.00 from 5." */
  answer: (sent: string, sentPeople: number, received: string, receivedPeople: number) =>
    `You sent ${sent} to ${sentPeople} ${sentPeople === 1 ? "person" : "people"} and received ${received} from ${receivedPeople}.`,
  moreReceived: (net: string) => `Overall, people sent you ${net} more than you sent them.`,
  moreSent: (net: string) => `Overall, you sent people ${net} more than they sent you.`,
  even: "Overall, people sent you as much as you sent them.",
  none: "No money moved between you and other people in this statement.",
  /** T-UNVERIFIED: the API's totals, shown without doors. */
  apiTotals: (sent: string, received: string) => `Sent ${sent}; received ${received}, as calculated when your statement was imported.`,
  derived: "Calculated from your transactions",
};

export const purpose = {
  title: "We can't tell what these payments were for",
  body: "An M-Pesa statement records who you sent money to, not why. A send could be rent, family support, a loan, or paying someone for goods. So sends stay out of Spending, and nothing here guesses their purpose.",
  engine: "Engine label: TRANSFER_OUT • economic meaning NOT_DETERMINABLE",
};

export const peopleList = {
  title: "Who you exchanged money with",
  subtitle: "Grouped by the name on the statement. Tap an amount to see its rows.",
  none: "No money moved between you and other people in this statement.",
  /** M-16: identity is the stored name; the API has no phone number. */
  identity: "The same person can appear under two spellings, and two people can share a name. Grouping by phone number needs the parser to keep the number.",
  /** Accessible name of a person's door: "Sent to Mary Wanjiku: KES 2,000.00, see the rows". */
  doorLabel: (direction: "sent" | "received", name: string, amount: string) =>
    `${direction === "sent" ? "Sent to" : "Received from"} ${name}: ${amount}, see the rows`,
};

export const largest = {
  title: "Largest sends",
  subtitle: "Each opens the receipt in Ledger.",
  none: "No money was sent to people in this statement.",
  /** "See all 14 sends in Ledger". */
  exit: (count: number) => `See all ${count} ${count === 1 ? "send" : "sends"} in Ledger`,
  charge: (amount: string) => `+ ${amount} charge`,
  noCharge: "No charge",
};

export const directions = {
  title: "Both directions",
  sent: "Sent",
  received: "Received",
  /** "14 sends to 6 people". */
  sentDetail: (sends: string, people: number) => `${sends} to ${people} ${people === 1 ? "person" : "people"}`,
  receivedDetail: (payments: string, people: number) => `${payments} from ${people} ${people === 1 ? "person" : "people"}`,
  /** Followed by a link to the Money In area (Stage 7f). */
  moneyIn: "Received money is also part of",
  moneyInLink: "Money In",
};

export const sendCost = {
  title: "What sending cost",
  /** Q-LINK, display only: "Sending money carried KES 105.00 in charges across 14 sends. They are counted once, in". */
  carried: (amount: string, sends: number) => `Sending money carried ${amount} in charges across ${sends} ${sends === 1 ? "send" : "sends"}. They are counted once, in`,
  none: "No charges were linked to your sends. Charges are counted in",
  fees: "Fees",
};

export const ownTransfer = {
  title: "Not the same as a transfer",
  /** T-PLANNED label (decision Q-P1). */
  planned: "Not available yet",
  body: "A transfer moves money between your own accounts, for example from your bank to M-Pesa. This statement can't show that the other side is yours, so no row here is treated as one.",
};
