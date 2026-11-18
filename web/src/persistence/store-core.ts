// The store's view of the core (ADR 0017): plan an import, validate a plan, and analyze a ledger
// across its statements. Each goes through mpesa_core.bridge.call_json, which answers in an
// envelope of plain JSON; in the browser the statement engine's worker makes the call, in Node
// tests a CPython process does. Failures become StoreErrors carrying the core's code only.

import type { CoreTransaction, ImportPlan, Period } from "@/persistence/ledger";
import { StoreError, type StoreErrorCode } from "@/persistence/store-errors";

/** The core's answer to one call: its answer, or a code and at most a row position. */
export type CoreEnvelope =
  | { ok: true; answer: unknown }
  | { ok: false; error: { code: string; row_index: number | null } };

/** Calls one core function by name with JSON request text. */
export type CoreCall = (functionName: string, requestText: string) => Promise<CoreEnvelope>;

/** What the core's merged analysis answers. */
export type MergedAnalysis = { period: Period; closing_balance: number | null; report: unknown };

/** The three core functions the store uses. */
export type StoreCore = {
  planImport(incomingRows: CoreTransaction[], existingTransactions: CoreTransaction[]): Promise<ImportPlan>;
  validateImportPlan(
    plan: unknown,
    incomingRows: CoreTransaction[],
    existingTransactions: CoreTransaction[],
  ): Promise<void>;
  analyzeMerged(request: { transactions: CoreTransaction[]; statements: unknown[] }): Promise<MergedAnalysis>;
};

/**
 * The store's core, over one way of calling the bridge.
 *
 * @param call How to call `call_json`: the engine's worker, or a test's CPython process.
 * @returns The three functions. Side effects: none until called; each call runs the core.
 */
export function storeCoreFrom(call: CoreCall): StoreCore {
  return {
    planImport: async (incomingRows, existingTransactions) =>
      (await answerOf(
        call,
        "plan_statement_import",
        { incoming_rows: incomingRows, existing_transactions: existingTransactions },
        "PLAN_FAILED",
      )) as ImportPlan,
    validateImportPlan: async (plan, incomingRows, existingTransactions) => {
      await answerOf(
        call,
        "validate_import_plan",
        { incoming_rows: incomingRows, existing_transactions: existingTransactions, plan },
        "PLAN_REFUSED",
      );
    },
    analyzeMerged: async (request) =>
      (await answerOf(call, "analyze_merged", request, "ANALYSIS_FAILED")) as MergedAnalysis,
  };
}

/**
 * Call one core function and return its answer, or throw its failure as a StoreError.
 *
 * @param call The bridge call.
 * @param functionName The core function.
 * @param request The request, sent as JSON text.
 * @param failureCode The StoreError code for a failure; the core's code goes in `detail`.
 * @returns The answer. Side effects: runs the core.
 * @throws {StoreError} `failureCode`, with the core's code and row.
 */
async function answerOf(call: CoreCall, functionName: string, request: unknown, failureCode: StoreErrorCode): Promise<unknown> {
  const envelope = await call(functionName, JSON.stringify(request));
  if (!envelope.ok) throw new StoreError(failureCode, { detail: envelope.error.code, rowIndex: envelope.error.row_index });
  return envelope.answer;
}
