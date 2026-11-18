// One ledger: everything remembered for one account, as plain JSON inside one encrypted blob
// (ADR 0016, ADR 0017). It holds what the old database's tables held: statements, transactions
// (each stored once), provenance links, analytics snapshots and domain observations. Every
// function here is pure: it returns a new ledger and never changes the one it is given, so an
// import that fails part way leaves nothing behind. The store saves a ledger in one write.

import { StoreError } from "@/persistence/store-errors";

/** The layout of a ledger, inside the vault's blob. */
export const LEDGER_FORMAT = 1;
/** The contract version tagged on every snapshot: the core's report, computed locally. */
export const ANALYTICS_CONTRACT_VERSION = "local-1";
/** The domain observation categories the old system knew; any other is refused. */
export const OBSERVATION_CATEGORIES = [
  "unsupported_entity_grammar",
  "unrecognized_event_type",
  "unexpected_receipt_event_type_collision",
] as const;
/** Every field of a transaction as the core gives it (contracts.ClassifiedRow). */
export const TRANSACTION_FIELDS = [
  "receipt_no",
  "completion_time",
  "details",
  "status",
  "paid_in",
  "withdrawn",
  "paid_out",
  "balance",
  "event_type",
  "cash_flow_direction",
  "economic_meaning",
  "total_cost",
  "entity",
] as const;
/** The fields identity compares (docs/decisions/identity-behaviour.md), kept as collision evidence. */
export const MATERIAL_FIELDS = [
  "receipt_no",
  "event_type",
  "completion_time",
  "details",
  "status",
  "paid_in",
  "paid_out",
  "balance",
] as const;

const UNCLASSIFIED = "UNCLASSIFIED";
const COLLISION_CATEGORY = "unexpected_receipt_event_type_collision";
const UNRECOGNIZED_CATEGORY = "unrecognized_event_type";

export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];
/** A transaction as the core gives it. */
export type CoreTransaction = Record<(typeof TRANSACTION_FIELDS)[number], unknown>;
/** A transaction as the ledger stores it: the core's fields, unchanged, and a ledger id. */
export type StoredTransaction = CoreTransaction & { id: number };
export type ImportCounts = { new: number; matched: number; collided: number };
/** What the statement checks card needs after a reload (N-31). */
export type StatementQuality = {
  row_count: number;
  chain_breaks: number;
  chain_orientation: string;
  totals_match: "yes" | "no" | "not_found";
  unclassified_rows: number;
  unclassified_share: number;
};
export type Period = { start: string | null; end: string | null };
export type StoredStatement = {
  id: number;
  imported_at: string;
  period: Period;
  row_count: number;
  /** The transaction each printed row is, in print order; a repeated row repeats its id. */
  transaction_ids: number[];
  counts: ImportCounts;
  quality: StatementQuality | null;
  verification_instruction: string | null;
};
/** Provenance: a statement observed a transaction. Each pair once. */
export type Link = { statement_id: number; transaction_id: number };
export type StoredSnapshot = {
  id: number;
  statement_id: number;
  contract_version: string;
  computed_at: string;
  /** The report as JSON text, written at import time, so later changes cannot reach it. */
  result_json: string;
};
export type StoredObservation = {
  id: number;
  statement_id: number;
  transaction_id: number | null;
  observed_at: string;
  category: ObservationCategory;
  raw_details: Record<string, unknown>;
  status: "new";
};
export type Ledger = {
  format: number;
  next_id: number;
  statements: StoredStatement[];
  transactions: StoredTransaction[];
  links: Link[];
  snapshots: StoredSnapshot[];
  observations: StoredObservation[];
};

export type PlanReference = { source: "existing" | "incoming"; index: number };
export type PlanAction = {
  row_index: number;
  action: "insert" | "link" | "preserve";
  target: PlanReference | null;
  collides_with: PlanReference[];
  observation: { category: string } | null;
};
/** The core's import plan (contracts.ImportPlan), already validated by the core. */
export type ImportPlan = { actions: PlanAction[]; counts: ImportCounts };

/** The parts of a pipeline result the store keeps. Never the token or the account digest. */
export type PipelineResultForStore = {
  period: Period;
  transactions: CoreTransaction[];
  report: unknown;
  quality: Record<string, unknown>;
  verification_instruction?: string | null;
};
/** An observation the caller adds to an import, as the old import took them. */
export type ImportObservation = { category: string; raw_details: Record<string, unknown>; transaction_index?: number };

/**
 * A ledger with nothing in it.
 *
 * @returns The empty ledger. Side effects: none.
 */
export function emptyLedger(): Ledger {
  return { format: LEDGER_FORMAT, next_id: 1, statements: [], transactions: [], links: [], snapshots: [], observations: [] };
}

/**
 * Apply one statement's validated import plan, as the old atomic import did: the statement; each
 * row inserted, linked or preserved (with its collision observation) and linked to the statement;
 * the snapshot, if there is a report; then the observations: one `unrecognized_event_type` per
 * unclassified row, then the caller's.
 *
 * @param ledger The ledger the plan was made against.
 * @param importRequest `pipelineResult`, the core's `plan` for it, `importedAt` (the web layer's
 *   time, used for the statement, the snapshot's computed_at and the observations), and optional
 *   `observations`.
 * @returns The new ledger and the statement's id. Side effects: none; `ledger` is unchanged.
 * @throws {StoreError} STATEMENT_INCOMPLETE, TRANSACTION_INCOMPLETE (with the row),
 *   UNKNOWN_OBSERVATION_CATEGORY, or PLAN_REFUSED when the plan does not fit the rows.
 */
export function applyStatementImport(
  ledger: Ledger,
  importRequest: {
    pipelineResult: PipelineResultForStore;
    plan: ImportPlan;
    importedAt: string;
    observations?: ImportObservation[];
  },
): { ledger: Ledger; statementId: number } {
  const { pipelineResult, plan, importedAt } = importRequest;
  const incoming = pipelineResult.transactions;
  if (plan.actions.length !== incoming.length) throw new StoreError("PLAN_REFUSED", { detail: "ROW_ACTION_COUNT" });
  const draft = structuredClone(ledger);
  const existingIds = draft.transactions.map((stored) => stored.id);
  const statementId = pushStatement(draft, {
    transactions: incoming,
    importedAt,
    period: pipelineResult.period,
    quality: statementQualityOf(pipelineResult.quality),
    counts: plan.counts,
    verificationInstruction: pipelineResult.verification_instruction ?? null,
  });
  const rowIds: number[] = [];
  incoming.forEach((incomingRow, rowIndex) => {
    const action = plan.actions[rowIndex];
    const resolve = (reference: PlanReference | null) => referencedId(reference, existingIds, rowIds);
    const transactionId = action.action === "link" ? resolve(action.target) : pushTransaction(draft, incomingRow, rowIndex);
    if (action.action === "preserve") {
      pushObservation(draft, {
        statementId,
        transactionId,
        category: COLLISION_CATEGORY,
        rawDetails: { incoming: materialFieldsOf(incomingRow), existing_transaction_ids: action.collides_with.map(resolve) },
        observedAt: importedAt,
      });
    }
    rowIds.push(transactionId);
    pushLink(draft, statementId, transactionId);
  });
  findStatement(draft, statementId).transaction_ids = rowIds;
  if (pipelineResult.report !== null && pipelineResult.report !== undefined) {
    pushSnapshot(draft, statementId, pipelineResult.report, importedAt);
  }
  for (const observation of importObservations(incoming, importRequest.observations ?? [])) {
    pushObservation(draft, {
      statementId,
      transactionId: observation.transaction_index === undefined ? null : rowIds[observation.transaction_index],
      category: observation.category,
      rawDetails: observation.raw_details,
      observedAt: importedAt,
    });
  }
  return { ledger: draft, statementId };
}

/**
 * Store one transaction as a new row, its values copied unchanged: nothing is classified or
 * recalculated, and no identity is checked (the plan decides that).
 *
 * @param ledger The ledger.
 * @param transaction A transaction holding every field of `TRANSACTION_FIELDS` (entity may be null).
 * @returns The new ledger and the transaction's id. Side effects: none.
 * @throws {StoreError} TRANSACTION_INCOMPLETE when a field is missing.
 */
export function insertTransaction(ledger: Ledger, transaction: CoreTransaction): { ledger: Ledger; transactionId: number } {
  const draft = structuredClone(ledger);
  return { ledger: draft, transactionId: pushTransaction(draft, transaction, 0) };
}

/**
 * Record a completed statement, without its rows (the import links them).
 *
 * @param ledger The ledger.
 * @param statement Its `transactions` (for the row count), `importedAt` and `period`; optional
 *   `quality`, `counts` and `verificationInstruction`.
 * @returns The new ledger and the statement's id. Side effects: none.
 * @throws {StoreError} STATEMENT_INCOMPLETE without transactions, or with one lacking a time.
 */
export function addStatement(
  ledger: Ledger,
  statement: {
    transactions: CoreTransaction[];
    importedAt: string;
    period: Period;
    quality?: StatementQuality | null;
    counts?: ImportCounts;
    verificationInstruction?: string | null;
  },
): { ledger: Ledger; statementId: number } {
  const draft = structuredClone(ledger);
  return { ledger: draft, statementId: pushStatement(draft, statement) };
}

/**
 * Record that a statement observed a transaction. Linking a pair already linked changes nothing.
 *
 * @param ledger The ledger.
 * @param statementId The statement.
 * @param transactionId The transaction.
 * @returns The new ledger and the association. Side effects: none.
 * @throws {StoreError} STATEMENT_NOT_FOUND or TRANSACTION_NOT_FOUND.
 */
export function linkStatementTransaction(
  ledger: Ledger,
  statementId: number,
  transactionId: number,
): { ledger: Ledger; link: Link } {
  const draft = structuredClone(ledger);
  findStatement(draft, statementId);
  if (!draft.transactions.some((stored) => stored.id === transactionId)) throw new StoreError("TRANSACTION_NOT_FOUND");
  return { ledger: draft, link: pushLink(draft, statementId, transactionId) };
}

/**
 * Keep a statement's report as a snapshot: its JSON text now, tagged with the contract version.
 *
 * @param ledger The ledger.
 * @param statementId The statement.
 * @param report The report (the core's to-JSON-safe output).
 * @param computedAt The web layer's time.
 * @returns The new ledger and the snapshot's id. Side effects: none.
 * @throws {StoreError} STATEMENT_NOT_FOUND.
 */
export function addSnapshot(
  ledger: Ledger,
  statementId: number,
  report: unknown,
  computedAt: string,
): { ledger: Ledger; snapshotId: number } {
  const draft = structuredClone(ledger);
  findStatement(draft, statementId);
  return { ledger: draft, snapshotId: pushSnapshot(draft, statementId, report, computedAt) };
}

/**
 * Record a domain observation, scoped to a statement and optionally to one transaction, with
 * status "new". The described transaction is not read or changed.
 *
 * @param ledger The ledger.
 * @param observation Its `statementId`, `transactionId` (or null), `category`, `rawDetails` and
 *   `observedAt`.
 * @returns The new ledger and the observation's id. Side effects: none.
 * @throws {StoreError} UNKNOWN_OBSERVATION_CATEGORY, STATEMENT_NOT_FOUND or TRANSACTION_NOT_FOUND.
 */
export function addObservation(
  ledger: Ledger,
  observation: {
    statementId: number;
    transactionId: number | null;
    category: string;
    rawDetails: Record<string, unknown>;
    observedAt: string;
  },
): { ledger: Ledger; observationId: number } {
  const draft = structuredClone(ledger);
  findStatement(draft, observation.statementId);
  if (observation.transactionId !== null && !draft.transactions.some((stored) => stored.id === observation.transactionId)) {
    throw new StoreError("TRANSACTION_NOT_FOUND");
  }
  return { ledger: draft, observationId: pushObservation(draft, observation) };
}

/**
 * Remove a statement with its links, observations and snapshots, and every transaction no other
 * statement observed (ADR 0017: no remembered row outlives every statement that printed it).
 *
 * @param ledger The ledger.
 * @param statementId The statement.
 * @returns The new ledger. Side effects: none.
 * @throws {StoreError} STATEMENT_NOT_FOUND.
 */
export function deleteStatement(ledger: Ledger, statementId: number): Ledger {
  findStatement(ledger, statementId);
  const links = ledger.links.filter((link) => link.statement_id !== statementId);
  const observed = new Set(links.map((link) => link.transaction_id));
  return structuredClone({
    ...ledger,
    statements: ledger.statements.filter((statement) => statement.id !== statementId),
    links,
    snapshots: ledger.snapshots.filter((snapshot) => snapshot.statement_id !== statementId),
    observations: ledger.observations.filter((observation) => observation.statement_id !== statementId),
    transactions: ledger.transactions.filter((stored) => observed.has(stored.id)),
  });
}

/**
 * A statement's transactions in print order: one per printed row.
 *
 * @param ledger The ledger.
 * @param statementId The statement.
 * @returns The stored transactions. Side effects: none.
 * @throws {StoreError} STATEMENT_NOT_FOUND.
 */
export function statementTransactions(ledger: Ledger, statementId: number): StoredTransaction[] {
  const byId = new Map(ledger.transactions.map((stored) => [stored.id, stored]));
  return findStatement(ledger, statementId).transaction_ids.map((transactionId) => byId.get(transactionId) as StoredTransaction);
}

/**
 * The statements that observed a transaction, in import order.
 *
 * @param ledger The ledger.
 * @param transactionId The transaction.
 * @returns Statement ids. Side effects: none.
 */
export function transactionStatements(ledger: Ledger, transactionId: number): number[] {
  return ledger.links.filter((link) => link.transaction_id === transactionId).map((link) => link.statement_id);
}

/**
 * A statement's snapshots, with each report read back from its JSON text.
 *
 * @param ledger The ledger.
 * @param statementId The statement.
 * @returns The snapshots, oldest first, each with `result`. Side effects: none.
 */
export function snapshotsOf(ledger: Ledger, statementId: number): (StoredSnapshot & { result: unknown })[] {
  return ledger.snapshots
    .filter((snapshot) => snapshot.statement_id === statementId)
    .map((snapshot) => ({ ...snapshot, result: JSON.parse(snapshot.result_json) }));
}

/**
 * Observations of a statement or of a transaction.
 *
 * @param ledger The ledger.
 * @param scope `statementId` or `transactionId`.
 * @returns The observations, oldest first. Side effects: none.
 */
export function observationsFor(
  ledger: Ledger,
  scope: { statementId?: number; transactionId?: number },
): StoredObservation[] {
  return ledger.observations.filter((observation) =>
    scope.statementId !== undefined
      ? observation.statement_id === scope.statementId
      : observation.transaction_id === scope.transactionId,
  );
}

/**
 * The ledger's transactions as the core takes them, in store order: the plan's "existing" list.
 *
 * @param ledger The ledger.
 * @returns The transactions without their ledger ids. Side effects: none.
 */
export function coreRowsOf(ledger: Ledger): CoreTransaction[] {
  return ledger.transactions.map(
    (stored) => Object.fromEntries(TRANSACTION_FIELDS.map((field) => [field, stored[field]])) as CoreTransaction,
  );
}

/**
 * What the core's merged analysis takes (ADR 0017): the ledger's transactions, and each statement
 * in import order with its period, orientation and rows by position.
 *
 * @param ledger The ledger.
 * @returns The request's two lists. Side effects: none.
 */
export function mergedAnalysisRequest(ledger: Ledger): {
  transactions: CoreTransaction[];
  statements: { period: Period; chain_orientation: string | null; transaction_indices: number[] }[];
} {
  const positions = new Map(ledger.transactions.map((stored, position) => [stored.id, position]));
  return {
    transactions: coreRowsOf(ledger),
    statements: ledger.statements.map((statement) => ({
      period: statement.period,
      chain_orientation: statement.quality?.chain_orientation ?? null,
      transaction_indices: statement.transaction_ids.map((transactionId) => positions.get(transactionId) as number),
    })),
  };
}

/**
 * The checks a statement's quality gives, from the core's data quality.
 *
 * @param quality The pipeline result's `quality`.
 * @returns The counts the checks card shows; totals are "not_found" unless both could be read.
 *   Side effects: none.
 */
export function statementQualityOf(quality: Record<string, unknown>): StatementQuality {
  const paidIn = quality.summary_total_paid_in_matches;
  const paidOut = quality.summary_total_paid_out_matches;
  const found = paidIn !== null && paidIn !== undefined && paidOut !== null && paidOut !== undefined;
  return {
    row_count: quality.row_count as number,
    chain_breaks: quality.chain_breaks as number,
    chain_orientation: quality.chain_orientation as string,
    totals_match: !found ? "not_found" : paidIn && paidOut ? "yes" : "no",
    unclassified_rows: quality.unclassified_rows as number,
    unclassified_share: quality.unclassified_share as number,
  };
}

/**
 * Append a statement to a draft.
 *
 * @param draft The ledger being built.
 * @param statement As for `addStatement`.
 * @returns The statement's id. Side effects: changes `draft`.
 * @throws {StoreError} STATEMENT_INCOMPLETE.
 */
function pushStatement(
  draft: Ledger,
  statement: Parameters<typeof addStatement>[1],
): number {
  const hasTimes = statement.transactions.every((transaction) => Boolean(transaction.completion_time));
  if (statement.transactions.length === 0 || !hasTimes) throw new StoreError("STATEMENT_INCOMPLETE");
  const statementId = draft.next_id++;
  draft.statements.push({
    id: statementId,
    imported_at: statement.importedAt,
    period: { start: statement.period.start, end: statement.period.end },
    row_count: statement.transactions.length,
    transaction_ids: [],
    counts: statement.counts ?? { new: 0, matched: 0, collided: 0 },
    quality: statement.quality ?? null,
    verification_instruction: statement.verificationInstruction ?? null,
  });
  return statementId;
}

/**
 * Append a transaction to a draft, its fields copied unchanged.
 *
 * @param draft The ledger being built.
 * @param transaction The transaction.
 * @param rowIndex Its position in the statement, for the error.
 * @returns Its id. Side effects: changes `draft`.
 * @throws {StoreError} TRANSACTION_INCOMPLETE.
 */
function pushTransaction(draft: Ledger, transaction: CoreTransaction, rowIndex: number): number {
  const isRecord = transaction !== null && typeof transaction === "object";
  if (!isRecord || !TRANSACTION_FIELDS.every((field) => field in transaction)) {
    throw new StoreError("TRANSACTION_INCOMPLETE", { rowIndex });
  }
  const transactionId = draft.next_id++;
  const copied = Object.fromEntries(TRANSACTION_FIELDS.map((field) => [field, transaction[field]])) as CoreTransaction;
  draft.transactions.push({ ...copied, id: transactionId });
  return transactionId;
}

/**
 * Link a statement to a transaction in a draft, once.
 *
 * @param draft The ledger being built.
 * @param statementId The statement.
 * @param transactionId The transaction.
 * @returns The association. Side effects: changes `draft`.
 */
function pushLink(draft: Ledger, statementId: number, transactionId: number): Link {
  const link = { statement_id: statementId, transaction_id: transactionId };
  const exists = draft.links.some((held) => held.statement_id === statementId && held.transaction_id === transactionId);
  if (!exists) draft.links.push(link);
  return link;
}

/**
 * Append a snapshot to a draft.
 *
 * @param draft The ledger being built.
 * @param statementId The statement.
 * @param report The report.
 * @param computedAt The web layer's time.
 * @returns Its id. Side effects: changes `draft`.
 */
function pushSnapshot(draft: Ledger, statementId: number, report: unknown, computedAt: string): number {
  const snapshotId = draft.next_id++;
  draft.snapshots.push({
    id: snapshotId,
    statement_id: statementId,
    contract_version: ANALYTICS_CONTRACT_VERSION,
    computed_at: computedAt,
    result_json: JSON.stringify(report),
  });
  return snapshotId;
}

/**
 * Append an observation to a draft.
 *
 * @param draft The ledger being built.
 * @param observation As for `addObservation`.
 * @returns Its id. Side effects: changes `draft`.
 * @throws {StoreError} UNKNOWN_OBSERVATION_CATEGORY.
 */
function pushObservation(draft: Ledger, observation: Parameters<typeof addObservation>[1]): number {
  if (!isKnownCategory(observation.category)) throw new StoreError("UNKNOWN_OBSERVATION_CATEGORY");
  const observationId = draft.next_id++;
  draft.observations.push({
    id: observationId,
    statement_id: observation.statementId,
    transaction_id: observation.transactionId,
    observed_at: observation.observedAt,
    category: observation.category,
    raw_details: structuredClone(observation.rawDetails),
    status: "new",
  });
  return observationId;
}

/**
 * The observations an import records after its rows: one per unclassified row, then the caller's.
 *
 * @param incoming The statement's transactions.
 * @param extra The caller's observations.
 * @returns The observations, each scoped by row position where it describes one row.
 *   Side effects: none.
 * @throws {StoreError} UNKNOWN_OBSERVATION_CATEGORY, before anything is applied.
 */
function importObservations(incoming: CoreTransaction[], extra: ImportObservation[]): ImportObservation[] {
  if (!extra.every((observation) => isKnownCategory(observation.category))) {
    throw new StoreError("UNKNOWN_OBSERVATION_CATEGORY");
  }
  const unrecognized = incoming.flatMap((transaction, index) =>
    transaction.event_type === UNCLASSIFIED
      ? [{ category: UNRECOGNIZED_CATEGORY, raw_details: { details: transaction.details }, transaction_index: index }]
      : [],
  );
  return [...unrecognized, ...extra];
}

/**
 * The ledger id a plan reference names.
 *
 * @param reference An existing transaction by store position, or a row added earlier by this plan.
 * @param existingIds The ids of the transactions stored before this import, in store order.
 * @param rowIds The ids given to this import's rows so far.
 * @returns The id. Side effects: none.
 * @throws {StoreError} PLAN_REFUSED when the reference names nothing.
 */
function referencedId(reference: PlanReference | null, existingIds: number[], rowIds: number[]): number {
  const transactionId = reference?.source === "existing" ? existingIds[reference.index] : rowIds[reference?.index ?? -1];
  if (transactionId === undefined) throw new StoreError("PLAN_REFUSED", { detail: "PLAN_MISMATCH" });
  return transactionId;
}

/**
 * A transaction's material fields, the evidence a collision observation keeps.
 *
 * @param transaction The transaction.
 * @returns Its material fields. Side effects: none.
 */
function materialFieldsOf(transaction: CoreTransaction): Record<string, unknown> {
  return Object.fromEntries(MATERIAL_FIELDS.map((field) => [field, transaction[field]]));
}

/**
 * A statement of a ledger.
 *
 * @param ledger The ledger.
 * @param statementId The statement.
 * @returns The statement. Side effects: none.
 * @throws {StoreError} STATEMENT_NOT_FOUND.
 */
function findStatement(ledger: Ledger, statementId: number): StoredStatement {
  const statement = ledger.statements.find((candidate) => candidate.id === statementId);
  if (!statement) throw new StoreError("STATEMENT_NOT_FOUND");
  return statement;
}

/**
 * Whether a category is one the store knows.
 *
 * @param category The category.
 * @returns True for a known one. Side effects: none.
 */
function isKnownCategory(category: string): category is ObservationCategory {
  return (OBSERVATION_CATEGORIES as readonly string[]).includes(category);
}
