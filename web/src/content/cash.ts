// Copy for the Cash area (IA migration Stage 7e), "What happened with cash
// withdrawals?". Every figure comes from the import (lib/statement/cash.ts);
// none is written here.

export const area = {
  title: "Cash",
  question: "What happened with cash withdrawals?",
  figureLabel: "Cash withdrawn",
  /** "4 withdrawals at 2 agents." */
  answer: (withdrawals: string, agents: number) => `${withdrawals} at ${agents} ${agents === 1 ? "agent" : "agents"}.`,
  /** Q-LINK, display only: " Withdrawing carried KES 163.00 in charges, 1.3% of the cash you took out." */
  charges: (amount: string, share: string) => ` Withdrawing carried ${amount} in charges, ${share} of the cash you took out.`,
  none: "You didn't withdraw any cash in this statement.",
  derived: "Calculated from your transactions",
};

export const whereCashWent = {
  title: "Where the cash went isn't on the statement",
  body: "A withdrawal turns M-Pesa money into cash in your pocket. Whatever it bought afterwards leaves no trace here, so cash is kept out of Spending rather than guessed at.",
};

export const agents = {
  title: "Agents used",
  subtitle: "Grouped by the name on the statement. Tap an agent to see its withdrawals.",
  none: "No cash was withdrawn in this statement.",
  /** "2 withdrawals". */
  detail: (withdrawals: string) => withdrawals,
};

export const largest = {
  title: "Largest withdrawals",
  subtitle: "Each opens the receipt in Ledger.",
  none: "No cash was withdrawn in this statement.",
  /** "See all 4 withdrawals in Ledger"; one withdrawal: "See the withdrawal in Ledger". */
  exit: (count: number) => (count === 1 ? "See the withdrawal in Ledger" : `See all ${count} withdrawals in Ledger`),
  charge: (amount: string) => `+ ${amount} charge`,
  noCharge: "No charge",
};

export const cost = {
  title: "What withdrawing cost",
  /** Q-LINK, display only. */
  carried: (amount: string, withdrawals: number) =>
    `Withdrawing carried ${amount} in charges across ${withdrawals} ${withdrawals === 1 ? "withdrawal" : "withdrawals"}. They are counted once, in`,
  none: "No charges were linked to your withdrawals. Charges are counted in",
  fees: "Fees",
};

export const deposits = {
  title: "Cash you deposited",
  /** Followed by a link to the Money In area (Stage 7f). */
  body: "Cash paid into M-Pesa at an agent is money coming in, so it is part of",
  link: "Money In",
  after: ", not this page.",
};
