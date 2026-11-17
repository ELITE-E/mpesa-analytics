// The UI's data layer (CP8b item 2): the same exports the old API client had, answered by the
// statement engine in this browser (pdf_reader/), with an in-memory session. Nothing is stored:
// a reload forgets every statement. The PDF's bytes and its password go to the engine's worker
// and nowhere else.

import { create_statement_engine } from "../../../pdf_reader/engine_client.js";
import { DESKTOP_LIMITS } from "../../../pdf_reader/limits.js";
import {
  toAnalyticsSnapshot,
  toCreatedImport,
  toTransactions,
  type ImportPlan,
  type PipelineResult,
} from "@/data/adapter";
import { ApiError } from "@/data/api-error";
import { apiErrorFor, toApiError } from "@/data/messages";
import type { AnalyticsSnapshot, CreatedImport, ImportSummary, Transaction } from "@/data/types";

export { ApiError } from "@/data/api-error";
export type {
  AnalyticsResult,
  AnalyticsSnapshot,
  CreatedImport,
  ImportSummary,
  Transaction,
  TransactionPage,
} from "@/data/types";

/** The largest statement the engine reads on desktop, in bytes (pdf_reader/limits.js). */
export const MAX_STATEMENT_BYTES: number = DESKTOP_LIMITS.byteLimit;

const WORKER_URL = "/pdf_reader/reader.worker.js";
const RUNTIME_POINTER = "/runtime/current.json";

/** One step of a run, as the engine reports it: never anything from the statement. */
export type UploadProgress = { stage: "reading" | "core" | "analysis"; page?: number; page_count?: number };

/** What the data layer needs from the statement engine (pdf_reader/engine_client.js). */
export type StatementEngine = {
  run(request: {
    pdf_bytes: Uint8Array;
    password?: string;
    processed_at?: string;
    existing_transactions_json?: string;
    on_progress?: (step: UploadProgress) => void;
  }): Promise<{
    ok: boolean;
    pipeline_result_json?: string;
    plan_json?: string;
    failure?: { code: string; stage?: string; core_code?: string };
  }>;
  /** Load pandas ahead of the first statement. */
  warm_up?(): Promise<unknown>;
  /** Stop the run in progress: the engine terminates its worker. */
  cancel?(): void;
};

/** One statement read in this session. */
type SessionImport = {
  created: CreatedImport;
  transactions: Transaction[];
  snapshot: AnalyticsSnapshot;
  /** The core's own rows, for planning later statements against this one. */
  coreTransactions: PipelineResult["transactions"];
  checks: StatementChecks;
};

/** What the statement checks card shows, from the core's data quality (CP8b item 5). */
export type StatementChecks = {
  verification_token: string;
  /** Page 1's printed verification instruction, as printed; null when the core could not read it. */
  verification_instruction: string | null;
  row_count: number;
  chain_breaks: number;
  /** Whether the TOTAL row's paid in and paid out match the rows'; "not_found" without one. */
  totals_match: "yes" | "no" | "not_found";
  unclassified_rows: number;
  unclassified_share: number;
};

const session = { imports: [] as SessionImport[], nextId: 1 };
let engine: StatementEngine | null = null;
let warmedUp: Promise<unknown> | null = null;
/** Set by cancelUpload; read when the upload hands its bytes to the engine. */
let cancelRequested = false;

/**
 * Read a statement with the local engine and keep its result for this session.
 *
 * @param file The statement PDF the user chose.
 * @param password Its password, or "" if it has none. Handed to the engine once; never kept.
 * @param options.onProgress Called with each step the engine reports, for the processing screen.
 * @returns The import's summary, its report and its verification token.
 * @throws {ApiError} With the engine's or the core's code ("CANCELLED" when cancelled), and a
 *   message for the user.
 */
export async function uploadStatement(
  file: File,
  password: string,
  options: { onProgress?: (step: UploadProgress) => void } = {},
): Promise<CreatedImport> {
  cancelRequested = false;
  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  // A cancel that came while the file was being read stops the upload before the engine starts.
  if (cancelRequested) throw apiErrorFor("CANCELLED");
  const outcome = await currentEngine().run({
    pdf_bytes: pdfBytes,
    password: password || undefined,
    processed_at: new Date().toISOString(),
    existing_transactions_json: JSON.stringify(session.imports.flatMap((held) => held.coreTransactions)),
    on_progress: options.onProgress,
  });
  if (!outcome.ok || !outcome.pipeline_result_json || !outcome.plan_json) {
    throw outcome.failure ? toApiError(outcome.failure) : apiErrorFor("unexpected_error");
  }
  return keep(JSON.parse(outcome.pipeline_result_json), JSON.parse(outcome.plan_json));
}

/**
 * Stop the statement being read: the engine terminates its worker and starts a fresh one, and the
 * upload rejects with "CANCELLED". Nothing from that statement is kept.
 */
export function cancelUpload() {
  cancelRequested = true;
  engine?.cancel?.();
}

/**
 * Start the engine and load pandas in the background, once, as soon as the app opens, so the
 * first statement does not wait for them (CP8b item 4). Never blocks and never rejects.
 *
 * @returns Resolves once warmed, or once warming up failed (the first run then loads pandas).
 */
export function warmUp(): Promise<unknown> {
  if (warmedUp === null) warmedUp = Promise.resolve(currentEngine().warm_up?.()).catch(() => undefined);
  return warmedUp;
}

/**
 * The statements read in this session, newest first.
 *
 * @param limit How many to list.
 * @returns The page of summaries.
 */
export async function listImports(limit = 50): Promise<{ items: ImportSummary[] }> {
  return { items: [...session.imports].reverse().slice(0, limit).map((held) => held.created.import) };
}

/**
 * One statement's summary.
 *
 * @param importId Its local id.
 * @returns The summary.
 * @throws {ApiError} "import_not_found" if no statement in this session has that id.
 */
export async function getImport(importId: number): Promise<ImportSummary> {
  return held(importId).created.import;
}

/**
 * The summary of `importId`, or of the latest statement when none is given; null when the session
 * holds none.
 *
 * @param importId A local id, or null for the latest.
 * @returns The summary, or null.
 * @throws {ApiError} "import_not_found" for an id this session does not hold.
 */
export async function getImportOrLatest(importId: number | null): Promise<ImportSummary | null> {
  if (importId) return getImport(importId);
  return (await listImports(1)).items[0] ?? null;
}

/**
 * One statement's report, as the old API's analytics snapshot.
 *
 * @param importId Its local id.
 * @returns The snapshot.
 * @throws {ApiError} "import_not_found".
 */
export async function getAnalytics(importId: number): Promise<AnalyticsSnapshot> {
  return held(importId).snapshot;
}

/**
 * Every transaction of one statement, in print order. All of them are in memory, so the result is
 * always complete.
 *
 * @param importId Its local id.
 * @returns The transactions.
 * @throws {ApiError} "import_not_found".
 */
export async function getAllTransactions(importId: number): Promise<Transaction[]> {
  return held(importId).transactions;
}

/**
 * One statement's checks: its verification code, the balance chain, the summary totals and the
 * rows no rule recognised.
 *
 * @param importId Its local id.
 * @returns The checks.
 * @throws {ApiError} "import_not_found".
 */
export async function getStatementChecks(importId: number): Promise<StatementChecks> {
  return held(importId).checks;
}

/**
 * The error for transactions that do not match their summary. Kept from the old client: the
 * statement integrity checks (lib/statement/integrity.ts) use it.
 *
 * @returns The error, with a message safe to show.
 */
export function incompleteTransactionsError() {
  return new ApiError(
    0,
    "incomplete_transactions",
    "We couldn't load all of this statement's transactions, so figures that depend on them are hidden. Try again.",
  );
}

/**
 * Use another engine and start an empty session: for tests only.
 *
 * @param replacement The engine to use.
 */
export function useEngineForTests(replacement: StatementEngine) {
  engine = replacement;
  warmedUp = null;
  session.imports = [];
  session.nextId = 1;
}

/**
 * Keep a read statement in the session.
 *
 * @param result The pipeline result.
 * @param plan The import plan against the session's earlier statements.
 * @returns What the upload answers with.
 */
function keep(result: PipelineResult, plan: ImportPlan): CreatedImport {
  const importId = session.nextId++;
  const created = toCreatedImport(importId, result, plan);
  session.imports.push({
    created,
    transactions: toTransactions(importId, result),
    snapshot: toAnalyticsSnapshot(importId, result),
    coreTransactions: result.transactions,
    checks: toStatementChecks(result),
  });
  return created;
}

/**
 * The checks the card shows, from the pipeline result.
 *
 * @param result The pipeline result.
 * @returns The checks; the totals are "not_found" unless both TOTAL figures could be read.
 */
function toStatementChecks(result: PipelineResult): StatementChecks {
  const quality = result.quality as Record<string, unknown>;
  const paidIn = quality.summary_total_paid_in_matches;
  const paidOut = quality.summary_total_paid_out_matches;
  return {
    verification_token: result.verification_token,
    verification_instruction: result.verification_instruction,
    row_count: quality.row_count as number,
    chain_breaks: quality.chain_breaks as number,
    totals_match: paidIn === null || paidOut === null ? "not_found" : paidIn && paidOut ? "yes" : "no",
    unclassified_rows: quality.unclassified_rows as number,
    unclassified_share: quality.unclassified_share as number,
  };
}

/**
 * Find a statement of this session.
 *
 * @param importId Its local id.
 * @returns The statement.
 * @throws {ApiError} "import_not_found".
 */
function held(importId: number): SessionImport {
  const found = session.imports.find((candidate) => candidate.created.import.id === importId);
  if (!found) throw apiErrorFor("import_not_found");
  return found;
}

/**
 * The statement engine, started on first use.
 *
 * @returns The engine.
 */
function currentEngine(): StatementEngine {
  if (engine === null) engine = startBrowserEngine();
  return engine;
}

/**
 * Start the engine's worker on the runtime the pointer names.
 *
 * @returns The engine.
 */
function startBrowserEngine(): StatementEngine {
  const started = fetch(RUNTIME_POINTER)
    .then((response) => response.json())
    .then((pointer: { version: string }) =>
      create_statement_engine({
        create_worker: () => new Worker(WORKER_URL, { type: "module" }),
        runtime_url: `/runtime/${pointer.version}/`,
      }),
    );
  return {
    run: async (request) => (await started).run(request),
    warm_up: async () => (await started).warm_up(),
    cancel: () => {
      void started.then((browserEngine) => browserEngine.cancel());
    },
  };
}
