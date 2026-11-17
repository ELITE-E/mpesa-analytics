// The shapes the UI was built on, copied unchanged from the old API client (lib/api.ts), so
// every screen and derived figure fits the local data layer as it did the API.

export type ImportSummary = {
  id: number;
  imported_at: string;
  period_start: string;
  period_end: string;
  status: string;
  transaction_count: number;
  previously_imported_transaction_count: number;
  unclassified_transaction_count: number;
  observation_counts: Record<string, number>;
};

export type Transaction = {
  id: number;
  receipt_no: string;
  completion_time: string;
  details: string;
  transaction_status: string;
  event_type: string;
  entity: string;
  paid_in: number;
  paid_out: number;
  total_cost: number;
  balance: number;
  cash_flow_direction: "INFLOW" | "OUTFLOW";
  economic_meaning: string;
};

export type TransactionPage = {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
};

type Period = { start: string | null; end: string | null };

export type AnalyticsResult = {
  cash_flow: {
    total_inflow: number;
    total_outflow: number;
    net_cash_flow: number;
    closing_balance: number;
  };
  spending: {
    monthly_expenditure: { month: string; expenditure: number }[];
    top_recipients: { recipient: string; amount_received: number; ranking: number }[];
    largest_purchases: {
      transaction: string;
      recipient: string;
      amount: number;
      date: string;
      ranking: number;
    }[];
    spending_by_entity: { entity: string; amount: number }[];
    merchant_usage_frequency: { merchant: string; transaction_count: number; ranking: number }[];
    recurring_purchases: { merchant: string; occurrences: number; dates: string[]; amounts: number[] }[];
  };
  bills: {
    recurring_bills: { bill: string; occurrences: number; dates: string[]; amounts: number[] }[];
    bill_spending: { bill: string; amount: number; period: Period }[];
  };
  investments: {
    total_investment: { period: Period; investment_amount: number };
    by_platform: { platform: string; amount_invested: number }[];
    frequency: { investment_transactions: number; dates: string[]; frequency: number };
    monthly_investment: { month: string; investment_amount: number }[];
  };
  transfers: {
    total_transfers: { period: Period; total_transfer_amount: number };
    total_received: { period: Period; total_received: number };
    by_recipient_count: { recipient: string; transaction_count: number; ranking: number }[];
    monthly_transfer_amounts: { month: string; transfer_amount: number }[];
    largest_transfers: { recipient: string; amount: number; date: string; ranking: number }[];
  };
  fees: {
    total_fees: { period: Period; total_fees: number };
    mpesa_fees: { period: Period; fee_amount: number };
    transfer_charges: { period: Period; transfer_charge_amount: number };
  };
};

export type AnalyticsSnapshot = {
  import_id: number;
  contract_version: string;
  computed_at: string;
  result: AnalyticsResult;
};

export type CreatedImport = {
  import: ImportSummary;
  analytics: AnalyticsResult;
  verification_token: string;
};
