// Copy for the Breakdown level ("Why?"): its six analysis areas, with the
// labels, questions and icons of the IA prototype (content/statement.ts on
// agents/ia-prototype). An area opens its own Breakdown screen once migrated
// (Spending, Stage 7a; People, 7b; Fees, 7c; Savings & Investments, 7d; Cash,
// 7e; Money In, 7f). Every area now has its own screen.

export type AreaId = "spending" | "people" | "savings" | "fees" | "cash" | "money-in";

export type BreakdownArea = {
  id: AreaId;
  label: string;
  question: string;
  icon: string;
  /** The existing screen that answers the question, or null while the area is coming. */
  destination: { href: string; screen: string } | null;
};

export const BREAKDOWN_AREAS: BreakdownArea[] = [
  { id: "spending", label: "Spending", question: "What did I consume?", icon: "shopping_bag", destination: { href: "/breakdown/spending", screen: "Spending" } },
  { id: "people", label: "People", question: "How much money moved between me and other people?", icon: "group", destination: { href: "/breakdown/people", screen: "People" } },
  { id: "savings", label: "Savings & Investments", question: "How much did I set aside?", icon: "trending_up", destination: { href: "/breakdown/savings", screen: "Savings & Investments" } },
  { id: "fees", label: "Fees", question: "What did moving my money cost?", icon: "receipt", destination: { href: "/breakdown/fees", screen: "Fees" } },
  { id: "cash", label: "Cash", question: "What happened with cash withdrawals?", icon: "local_atm", destination: { href: "/breakdown/cash", screen: "Cash" } },
  { id: "money-in", label: "Money In", question: "Where did my money come from?", icon: "south_west", destination: { href: "/breakdown/money-in", screen: "Money In" } },
];

export const hub = {
  title: "Breakdown",
  question: "Why did my money move the way it did?",
  description: "Each area answers one question about this statement. Open an area to see its analysis.",
  ledgerLead: "To check a figure, see",
  ledgerDoor: "every transaction in the Ledger",
  ledgerDoorLabel: "See every transaction of this statement in the Ledger",
  openPrefix: "Open",
  comingLabel: "Coming in this release",
  allAreasLabel: "All areas",
  /** Stage 8a: "KES 118,240.00 went out and KES 142,500.00 came in." */
  wentOut: "went out and",
  cameIn: "came in.",
  /** "64.5% of money out". */
  shareOfOut: (share: string) => `${share} of money out`,
  none: "None in this statement",
  wentHeading: "Where money went",
  cameHeading: "Where money came from",
};

/** The "adds up" card (Stage 8a): every outflow bucket with money, supported by an area or not. */
export const addsUp = {
  title: "How the parts add up",
  subtitle: "Each shilling out is counted once, in exactly one line.",
  total: "Money out",
  empty: "No money went out in this statement.",
  /** The engine's fallback (src/engine.py): anything it can't match is UNCLASSIFIED. */
  unrecognised: "Some kinds of payment aren't recognised yet, for example Fuliza loan repayments. Until they are, they're counted in Not yet classified, so the total still matches your statement.",
};
