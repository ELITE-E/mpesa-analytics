// Turns the statement engine's output into the shapes the UI was built on (the old API's
// ImportSummary, Transaction, AnalyticsSnapshot and CreatedImport), so the screens and their
// derived figures fit unchanged. Pure functions; nothing here is stored.

import { NO_ENTITY } from "@/lib/statement/groups";
import type { AnalyticsResult, AnalyticsSnapshot, CreatedImport, ImportSummary, Transaction } from "@/data/types";

/** A transaction as the core gives it (contracts.ClassifiedRow). */
type CoreTransaction = {
  receipt_no: string;
  completion_time: string;
  details: string;
  status: string;
  paid_in: number;
  withdrawn: number;
  paid_out: number;
  balance: number;
  event_type: string;
  cash_flow_direction: string;
  economic_meaning: string;
  total_cost: number;
  entity: string | null;
};

/** The parts of the core's PipelineResult the UI reads. */
export type PipelineResult = {
  verification_token: string;
  verification_instruction: string | null;
  processed_at: string | null;
  period: { start: string | null; end: string | null };
  transactions: CoreTransaction[];
  report: AnalyticsResult;
  quality: { unclassified_rows: number } & Record<string, unknown>;
};

/** The import plan's counts (mpesa_core.contracts.ImportPlanCounts). */
export type ImportPlan = { counts: { new: number; matched: number; collided: number } };

/** Room for each import's rows in the id space: more than the 300-page limit could print. */
const IDS_PER_IMPORT = 1_000_000;
/** The old API's contract version, kept for the snapshot shape; marks local analysis. */
const LOCAL_CONTRACT_VERSION = "local-1";

/**
 * The statement's transactions as the UI's Transaction rows, in print order.
 *
 * @param importId The import's local id.
 * @param result The pipeline result.
 * @returns One row per transaction: `status` becomes `transaction_status`, a missing entity becomes
 *   the UI's "not identified" marker, and each row gets an id stable for this import.
 */
export function toTransactions(importId: number, result: PipelineResult): Transaction[] {
  return result.transactions.map((row, index) => ({
    id: importId * IDS_PER_IMPORT + index + 1,
    receipt_no: row.receipt_no,
    completion_time: row.completion_time,
    details: row.details,
    transaction_status: row.status,
    event_type: row.event_type,
    entity: row.entity ?? NO_ENTITY,
    paid_in: row.paid_in,
    paid_out: row.paid_out,
    total_cost: row.total_cost,
    balance: row.balance,
    cash_flow_direction: row.cash_flow_direction as Transaction["cash_flow_direction"],
    economic_meaning: row.economic_meaning,
  }));
}

/**
 * The import's summary.
 *
 * @param importId The import's local id.
 * @param result The pipeline result.
 * @param plan The import plan against the session's earlier statements.
 * @returns The summary: rows linked to an earlier statement count as previously imported, and
 *   collisions as observations.
 */
export function toImportSummary(importId: number, result: PipelineResult, plan: ImportPlan): ImportSummary {
  return {
    id: importId,
    imported_at: result.processed_at ?? "",
    period_start: result.period.start ?? "",
    period_end: result.period.end ?? "",
    status: "completed",
    transaction_count: result.transactions.length,
    previously_imported_transaction_count: plan.counts.matched,
    unclassified_transaction_count: result.quality.unclassified_rows,
    observation_counts: plan.counts.collided ? { COLLISION: plan.counts.collided } : {},
  };
}

/**
 * The import's analytics, as the old API returned them.
 *
 * @param importId The import's local id.
 * @param result The pipeline result.
 * @returns The snapshot: the core's report, computed when the statement was read.
 */
export function toAnalyticsSnapshot(importId: number, result: PipelineResult): AnalyticsSnapshot {
  return {
    import_id: importId,
    contract_version: LOCAL_CONTRACT_VERSION,
    computed_at: result.processed_at ?? "",
    result: result.report,
  };
}

/**
 * What an upload answers with.
 *
 * @param importId The import's local id.
 * @param result The pipeline result.
 * @param plan The import plan.
 * @returns The summary, the report and the verification token.
 */
export function toCreatedImport(importId: number, result: PipelineResult, plan: ImportPlan): CreatedImport {
  return {
    import: toImportSummary(importId, result, plan),
    analytics: result.report,
    verification_token: result.verification_token,
  };
}
