// CP9b item 4: the old persistence tests S-01 to S-54, under their old names, rewritten for the
// browser store (ADR 0017): Postgres rows become records inside one encrypted ledger blob, a new
// session means reload then unlock, and a persistence failure is a storage write that throws.
// The core's plans, validations and reports come from the real core under CPython. Every value is
// invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/store.test.ts

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { IDBObjectStore } from "fake-indexeddb";

import { startCpythonCore } from "./support/cpython-core.mjs";
import {
  DIGEST,
  IMPORTED_AT,
  LATER,
  TOKEN,
  createdStore,
  pipelineResult,
  report,
  row,
  rows,
} from "./support/store-fixtures.mjs";
import { dumpDatabases, holdsBytes } from "./support/vault-environment.mjs";

const ledger = await import("../src/persistence/ledger.ts");
const { StoreError } = await import("../src/persistence/store-errors.ts");
const repo = await import("../src/data/repo.ts");

let core;
before(() => {
  core = startCpythonCore();
});
after(async () => {
  repo.rememberOnThisDevice(null);
  await core.close();
});

const originalPut = IDBObjectStore.prototype.put;
afterEach(() => {
  IDBObjectStore.prototype.put = originalPut;
});

/** A copy of a record without one field. */
function without(record, field) {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

/** Make every IndexedDB put throw a quota error, as a full device does. */
function failWrites() {
  IDBObjectStore.prototype.put = function failingPut() {
    throw new DOMException("simulated quota", "QuotaExceededError");
  };
}

/** Run `action` and return the error it throws, checking its class and code. */
async function errorFrom(action, errorClass, code) {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof errorClass, `expected ${errorClass.name}, got ${error}`);
    if (code) assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected ${errorClass.name}`);
}

/** The ledger a store holds after remembering each result in turn. */
async function remembered(results) {
  const { store, vault, environment } = await createdStore(core);
  const outcomes = [];
  for (const result of results) outcomes.push(await store.rememberStatement({ pipelineResult: result, importedAt: IMPORTED_AT }));
  return { store, vault, environment, outcomes, held: store.currentLedger() };
}

/** A ledger holding one statement and nothing else, built without the core. */
function ledgerWithStatement() {
  return ledger.addStatement(ledger.emptyLedger(), {
    transactions: rows(1, 2),
    importedAt: IMPORTED_AT,
    period: { start: row(1).completion_time, end: row(2).completion_time },
  });
}

// A. Saving transactions

test("test_multiple_transactions_can_share_receipt_no_with_different_event_types", () => {
  const payment = row(1);
  const fee = row(1, { event_type: "MPESA_FEE", paid_out: 7, withdrawn: 7, total_cost: 7 });
  const first = ledger.insertTransaction(ledger.emptyLedger(), payment);
  const second = ledger.insertTransaction(first.ledger, fee);
  assert.equal(second.ledger.transactions.length, 2);
  assert.deepEqual(second.ledger.transactions.map((stored) => stored.event_type), ["MERCHANT_PAYMENT", "MPESA_FEE"]);
});

test("test_two_rows_with_identical_receipt_no_and_event_type_can_coexist", () => {
  const first = ledger.insertTransaction(ledger.emptyLedger(), row(1));
  const second = ledger.insertTransaction(first.ledger, row(1, { balance: 5 }));
  assert.equal(second.ledger.transactions.length, 2);
  assert.notEqual(first.transactionId, second.transactionId);
});

test("test_one_transaction_can_belong_to_multiple_statements", () => {
  const inserted = ledger.insertTransaction(ledger.emptyLedger(), row(1));
  const period = { start: row(1).completion_time, end: row(1).completion_time };
  const one = ledger.addStatement(inserted.ledger, { transactions: [row(1)], importedAt: IMPORTED_AT, period });
  const two = ledger.addStatement(one.ledger, { transactions: [row(1)], importedAt: LATER, period });
  let held = ledger.linkStatementTransaction(two.ledger, one.statementId, inserted.transactionId).ledger;
  held = ledger.linkStatementTransaction(held, two.statementId, inserted.transactionId).ledger;
  assert.deepEqual(ledger.transactionStatements(held, inserted.transactionId), [one.statementId, two.statementId]);
});

test("test_same_statement_transaction_pair_cannot_be_inserted_twice", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const inserted = ledger.insertTransaction(withStatement, row(1));
  const once = ledger.linkStatementTransaction(inserted.ledger, statementId, inserted.transactionId).ledger;
  const twice = ledger.linkStatementTransaction(once, statementId, inserted.transactionId).ledger;
  assert.equal(twice.links.filter((link) => link.statement_id === statementId).length, 1);
});

test("test_deleting_a_statement_cascades_to_its_statement_transactions", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 3)), pipelineResult(rows(3, 5))]);
  const after = ledger.deleteStatement(held, outcomes[0].statementId);
  assert.equal(after.links.some((link) => link.statement_id === outcomes[0].statementId), false);
  assert.equal(after.statements.some((statement) => statement.id === outcomes[0].statementId), false);
  assert.equal(after.links.filter((link) => link.statement_id === outcomes[1].statementId).length, 3);
});

test("test_deleting_a_statement_cascades_to_its_domain_observations", async () => {
  const unclassified = row(2, { event_type: "UNCLASSIFIED" });
  const { held, outcomes } = await remembered([pipelineResult([row(1), unclassified]), pipelineResult(rows(5, 6))]);
  assert.equal(held.observations.length, 1);
  const after = ledger.deleteStatement(held, outcomes[0].statementId);
  assert.deepEqual(after.observations, []);
});

test("test_multiple_snapshots_are_permitted_for_the_same_statement", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const once = ledger.addSnapshot(withStatement, statementId, report(1), IMPORTED_AT).ledger;
  const twice = ledger.addSnapshot(once, statementId, report(2), LATER).ledger;
  assert.equal(ledger.snapshotsOf(twice, statementId).length, 2);
});

test("test_persist_valid_transaction_creates_one_row", () => {
  const { ledger: held, transactionId } = ledger.insertTransaction(ledger.emptyLedger(), row(1));
  assert.equal(held.transactions.length, 1);
  assert.equal(held.transactions[0].id, transactionId);
});

test("test_persist_transaction_preserves_all_required_fields", () => {
  const incoming = row(1);
  const { ledger: held } = ledger.insertTransaction(ledger.emptyLedger(), incoming);
  const { id, ...stored } = held.transactions[0];
  assert.equal(typeof id, "number");
  assert.deepEqual(stored, incoming);
  assert.deepEqual(Object.keys(stored).sort(), [...ledger.TRANSACTION_FIELDS].sort());
});

test("test_persist_preserves_total_cost_distinct_from_paid_out", () => {
  const { ledger: held } = ledger.insertTransaction(ledger.emptyLedger(), row(1, { paid_out: 450, total_cost: 457 }));
  assert.equal(held.transactions[0].paid_out, 450);
  assert.equal(held.transactions[0].total_cost, 457);
});

test("test_persist_parent_and_fee_rows_sharing_receipt_no", () => {
  const parent = row(1, { total_cost: 457 });
  const fee = row(1, { event_type: "MPESA_FEE", paid_out: 7, withdrawn: 7, total_cost: 7, entity: null });
  const held = ledger.insertTransaction(ledger.insertTransaction(ledger.emptyLedger(), parent).ledger, fee).ledger;
  assert.deepEqual(held.transactions.map((stored) => stored.receipt_no), [parent.receipt_no, parent.receipt_no]);
  assert.equal(held.transactions[1].entity, null);
});

test("test_persist_does_not_enforce_receipt_no_event_type_uniqueness", () => {
  const twice = ledger.insertTransaction(ledger.insertTransaction(ledger.emptyLedger(), row(1)).ledger, row(1)).ledger;
  assert.equal(twice.transactions.length, 2);
});

test("test_persist_rejects_transaction_missing_entity", async () => {
  const withoutEntity = without(row(1), "entity");
  const before = ledger.emptyLedger();
  const error = await errorFrom(() => ledger.insertTransaction(before, withoutEntity), StoreError, "TRANSACTION_INCOMPLETE");
  assert.equal(error.message.includes("Example"), false);
  assert.deepEqual(before, ledger.emptyLedger());
});

test("test_persist_does_not_classify_or_recalculate_anything", () => {
  const odd = row(1, { event_type: "UNCLASSIFIED", cash_flow_direction: "INFLOW", economic_meaning: "UNKNOWN", total_cost: 1, paid_out: 999 });
  const { ledger: held } = ledger.insertTransaction(ledger.emptyLedger(), odd);
  assert.deepEqual(without(held.transactions[0], "id"), odd);
});

// B. Saving statements and links

test("test_successful_import_persists_one_completed_statement", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 3))]);
  assert.equal(outcomes[0].saved, true);
  assert.equal(held.statements.length, 1);
  const [statement] = held.statements;
  assert.equal(statement.imported_at, IMPORTED_AT);
  assert.deepEqual(statement.period, { start: row(1).completion_time, end: row(3).completion_time });
  assert.equal(statement.row_count, 3);
});

test("test_persisted_statement_is_retrievable_in_a_new_session", async () => {
  const { environment, outcomes } = await remembered([pipelineResult(rows(1, 3))]);
  const { store } = await createdStore(core, environment);
  await store.switchLedger(outcomes[0].ledgerId);
  assert.deepEqual(store.currentLedger().statements.map((statement) => statement.id), [outcomes[0].statementId]);
});

test("test_one_statement_links_many_transactions", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 4))]);
  assert.equal(held.links.filter((link) => link.statement_id === outcomes[0].statementId).length, 4);
});

test("test_link_returns_the_association", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const inserted = ledger.insertTransaction(withStatement, row(1));
  const { link } = ledger.linkStatementTransaction(inserted.ledger, statementId, inserted.transactionId);
  assert.deepEqual(link, { statement_id: statementId, transaction_id: inserted.transactionId });
});

test("test_one_transaction_links_to_many_statements", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 2)), pipelineResult(rows(2, 3))]);
  const shared = held.transactions.find((stored) => stored.receipt_no === row(2).receipt_no);
  assert.deepEqual(ledger.transactionStatements(held, shared.id), outcomes.map((outcome) => outcome.statementId));
});

test("test_overlapping_statements_share_canonical_transactions", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 4)), pipelineResult(rows(3, 6))]);
  assert.equal(held.transactions.length, 6);
  assert.deepEqual(outcomes[1].counts, { new: 2, matched: 2, collided: 0 });
  const firstIds = ledger.statementTransactions(held, outcomes[0].statementId).map((stored) => stored.id);
  const secondIds = ledger.statementTransactions(held, outcomes[1].statementId).map((stored) => stored.id);
  assert.deepEqual(secondIds.slice(0, 2), firstIds.slice(2));
});

test("test_linking_the_same_pair_twice_persists_one_association", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const inserted = ledger.insertTransaction(withStatement, row(1));
  let held = ledger.linkStatementTransaction(inserted.ledger, statementId, inserted.transactionId).ledger;
  held = ledger.linkStatementTransaction(held, statementId, inserted.transactionId).ledger;
  assert.equal(held.links.length, 1);
});

test("test_linking_an_already_committed_pair_persists_one_association", async () => {
  const { vault, outcomes, held } = await remembered([pipelineResult(rows(1, 1))]);
  const [link] = held.links;
  const reread = (await vault.readLedger(outcomes[0].ledgerId)).ledger;
  const relinked = ledger.linkStatementTransaction(reread, link.statement_id, link.transaction_id).ledger;
  assert.equal(relinked.links.length, 1);
});

// C. Saved analytics snapshots

test("test_snapshot_stores_to_json_safe_output_as_json", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 2), { report: report(321) })]);
  const [snapshot] = held.snapshots;
  assert.equal(snapshot.result_json, JSON.stringify(report(321)));
  assert.deepEqual(ledger.snapshotsOf(held, outcomes[0].statementId)[0].result, report(321));
});

test("test_snapshot_is_unaffected_by_later_changes_to_the_result", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const live = report(100);
  const held = ledger.addSnapshot(withStatement, statementId, live, IMPORTED_AT).ledger;
  live.cash_flow.total_outflow = 5;
  assert.equal(ledger.snapshotsOf(held, statementId)[0].result.cash_flow.total_outflow, 100);
});

test("test_snapshot_stores_the_explicit_contract_version", async () => {
  const { held } = await remembered([pipelineResult(rows(1, 2))]);
  assert.equal(held.snapshots[0].contract_version, ledger.ANALYTICS_CONTRACT_VERSION);
  assert.equal(ledger.ANALYTICS_CONTRACT_VERSION, "local-1");
});

test("test_snapshot_is_associated_with_its_statement", async () => {
  const { held, outcomes } = await remembered([pipelineResult(rows(1, 2)), pipelineResult(rows(3, 4))]);
  assert.deepEqual(held.snapshots.map((snapshot) => snapshot.statement_id), outcomes.map((outcome) => outcome.statementId));
});

test("test_persisted_snapshot_is_retrievable_in_a_new_session", async () => {
  const { environment, outcomes } = await remembered([pipelineResult(rows(1, 2), { report: report(77) })]);
  const { store } = await createdStore(core, environment);
  await store.switchLedger(outcomes[0].ledgerId);
  assert.deepEqual(ledger.snapshotsOf(store.currentLedger(), outcomes[0].statementId)[0].result, report(77));
});

// D. Observations

test("test_statement_scoped_observation_is_persisted", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const held = ledger.addObservation(withStatement, {
    statementId,
    transactionId: null,
    category: "unsupported_entity_grammar",
    rawDetails: { details: "Example grammar" },
    observedAt: IMPORTED_AT,
  }).ledger;
  assert.deepEqual(ledger.observationsFor(held, { statementId }).map((observation) => observation.transaction_id), [null]);
});

test("test_transaction_scoped_observation_is_persisted", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const inserted = ledger.insertTransaction(withStatement, row(1));
  const held = ledger.addObservation(inserted.ledger, {
    statementId,
    transactionId: inserted.transactionId,
    category: "unrecognized_event_type",
    rawDetails: { details: row(1).details },
    observedAt: IMPORTED_AT,
  }).ledger;
  assert.equal(ledger.observationsFor(held, { transactionId: inserted.transactionId }).length, 1);
});

test("test_observation_leaves_the_described_transaction_untouched", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const inserted = ledger.insertTransaction(withStatement, row(1));
  const before = structuredClone(inserted.ledger.transactions);
  const held = ledger.addObservation(inserted.ledger, {
    statementId,
    transactionId: inserted.transactionId,
    category: "unrecognized_event_type",
    rawDetails: {},
    observedAt: IMPORTED_AT,
  }).ledger;
  assert.deepEqual(held.transactions, before);
});

test("test_each_known_category_is_preserved_with_status_new", () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  let held = withStatement;
  for (const category of ledger.OBSERVATION_CATEGORIES) {
    held = ledger.addObservation(held, { statementId, transactionId: null, category, rawDetails: {}, observedAt: IMPORTED_AT }).ledger;
  }
  assert.deepEqual(held.observations.map((observation) => observation.category), [...ledger.OBSERVATION_CATEGORIES]);
  assert.deepEqual(new Set(held.observations.map((observation) => observation.status)), new Set(["new"]));
  assert.deepEqual([...ledger.OBSERVATION_CATEGORIES].sort(), [
    "unexpected_receipt_event_type_collision",
    "unrecognized_event_type",
    "unsupported_entity_grammar",
  ]);
});

test("test_unknown_category_is_rejected_and_persists_nothing", async () => {
  const { ledger: withStatement, statementId } = ledgerWithStatement();
  const before = structuredClone(withStatement);
  await errorFrom(
    () => ledger.addObservation(withStatement, { statementId, transactionId: null, category: "made_up", rawDetails: {}, observedAt: IMPORTED_AT }),
    StoreError,
    "UNKNOWN_OBSERVATION_CATEGORY",
  );
  assert.deepEqual(withStatement, before);
  const { store, environment } = await createdStore(core);
  const raw = await dumpDatabases(environment.indexedDB);
  await errorFrom(
    () =>
      store.rememberStatement({
        pipelineResult: pipelineResult(rows(1, 2)),
        importedAt: IMPORTED_AT,
        observations: [{ category: "made_up", raw_details: {} }],
      }),
    StoreError,
    "UNKNOWN_OBSERVATION_CATEGORY",
  );
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
});

test("test_observations_are_retrievable_through_statement_and_transaction", async () => {
  const unclassified = row(2, { event_type: "UNCLASSIFIED" });
  const { held, outcomes } = await remembered([pipelineResult([row(1), unclassified])]);
  const stored = held.transactions.find((transaction) => transaction.event_type === "UNCLASSIFIED");
  const byStatement = ledger.observationsFor(held, { statementId: outcomes[0].statementId });
  const byTransaction = ledger.observationsFor(held, { transactionId: stored.id });
  assert.equal(byStatement.length, 1);
  assert.deepEqual(byTransaction, byStatement);
  assert.equal(byStatement[0].category, "unrecognized_event_type");
});

// E. Collisions

test("test_collision_preserves_both_rows_and_leaves_the_original_unchanged", async () => {
  const original = row(1);
  const { held, outcomes } = await remembered([pipelineResult([original]), pipelineResult([row(1, { balance: 5 })])]);
  assert.deepEqual(outcomes[1].counts, { new: 0, matched: 0, collided: 1 });
  assert.equal(held.transactions.length, 2);
  assert.deepEqual(without(held.transactions[0], "id"), original);
});

test("test_collision_records_a_domain_observation", async () => {
  const { held, outcomes } = await remembered([pipelineResult([row(1)]), pipelineResult([row(1, { balance: 5 })])]);
  const [observation] = held.observations;
  assert.equal(observation.category, "unexpected_receipt_event_type_collision");
  assert.equal(observation.statement_id, outcomes[1].statementId);
  assert.equal(observation.transaction_id, held.transactions[1].id);
  assert.deepEqual(observation.raw_details.existing_transaction_ids, [held.transactions[0].id]);
  assert.equal(observation.raw_details.incoming.balance, 5);
  assert.deepEqual(Object.keys(observation.raw_details.incoming).sort(), [...ledger.MATERIAL_FIELDS].sort());
});

test("test_collision_with_multiple_candidates_preserves_every_row", async () => {
  const { held } = await remembered([
    pipelineResult([row(1)]),
    pipelineResult([row(1, { balance: 5 })]),
    pipelineResult([row(1, { balance: 6 })]),
  ]);
  assert.equal(held.transactions.length, 3);
  const last = held.observations.at(-1);
  assert.deepEqual(last.raw_details.existing_transaction_ids, [held.transactions[0].id, held.transactions[1].id]);
});

test("test_preserving_a_non_collision_is_rejected", async () => {
  const { store, environment } = await createdStore(core);
  const result = pipelineResult(rows(1, 2));
  const plan = {
    actions: result.transactions.map((_, index) => ({
      row_index: index,
      action: index === 1 ? "preserve" : "insert",
      target: null,
      collides_with: [],
      observation: index === 1 ? { category: "unexpected_receipt_event_type_collision" } : null,
    })),
    counts: { new: 1, matched: 0, collided: 1 },
  };
  const raw = await dumpDatabases(environment.indexedDB);
  const error = await errorFrom(() => store.rememberStatement({ pipelineResult: result, importedAt: IMPORTED_AT, plan }), StoreError, "PLAN_REFUSED");
  assert.equal(error.detail, "PRESERVE_NOT_COLLISION");
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
});

// F. One all-or-nothing import

test("test_successful_import_persists_every_component", async () => {
  const unclassified = row(3, { event_type: "UNCLASSIFIED" });
  const { held, outcomes } = await remembered([pipelineResult([row(1), row(2), unclassified])]);
  const { statementId } = outcomes[0];
  assert.equal(held.statements.length, 1);
  assert.equal(held.transactions.length, 3);
  assert.equal(held.links.length, 3);
  assert.equal(ledger.snapshotsOf(held, statementId).length, 1);
  assert.deepEqual(ledger.observationsFor(held, { statementId }).map((observation) => observation.category), ["unrecognized_event_type"]);
});

test("test_import_without_analytics_or_observations_is_persisted", async () => {
  const { held } = await remembered([pipelineResult(rows(1, 2), { report: null })]);
  assert.equal(held.statements.length, 1);
  assert.equal(held.transactions.length, 2);
  assert.deepEqual(held.snapshots, []);
  assert.deepEqual(held.observations, []);
});

test("test_failed_import_leaves_no_partial_records", async () => {
  const { store, environment, outcomes } = await remembered([pipelineResult(rows(1, 2))]);
  const raw = await dumpDatabases(environment.indexedDB);
  const broken = without(row(4), "entity");
  await errorFrom(
    () => store.rememberStatement({ pipelineResult: pipelineResult([row(3), broken, row(5)]), importedAt: LATER }),
    StoreError,
    "TRANSACTION_INCOMPLETE",
  );
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
  assert.equal(store.currentLedger().statements.length, 1);
  assert.equal(outcomes.length, 1);
});

test("test_repeated_observation_reuses_the_canonical_transaction", async () => {
  const statement = [row(1), row(2, { event_type: "UNCLASSIFIED" })];
  const { held } = await remembered([pipelineResult(statement), pipelineResult(statement)]);
  assert.equal(held.observations.length, 2);
  assert.equal(held.observations[0].transaction_id, held.observations[1].transaction_id);
  assert.equal(held.transactions.length, 2);
});

test("test_collision_preserves_both_transactions_and_records_an_observation", async () => {
  const { held } = await remembered([pipelineResult(rows(1, 2)), pipelineResult([row(2, { details: "Changed Example Shop 2" })])]);
  assert.equal(held.transactions.filter((stored) => stored.receipt_no === row(2).receipt_no).length, 2);
  assert.equal(held.observations.filter((observation) => observation.category === "unexpected_receipt_event_type_collision").length, 1);
});

test("test_persistence_receives_processed_transactions_and_analytics", async () => {
  const result = pipelineResult(rows(1, 3), { report: report(555) });
  const { vault, outcomes } = await remembered([result]);
  const stored = (await vault.readLedger(outcomes[0].ledgerId)).ledger;
  assert.deepEqual(stored.transactions.map((transaction) => without(transaction, "id")), result.transactions);
  assert.deepEqual(JSON.parse(stored.snapshots[0].result_json), report(555));
});

test("test_persistence_failure_propagates", async () => {
  const { store } = await createdStore(core);
  failWrites();
  const { VaultError } = await import("../src/persistence/vault-errors.ts");
  await errorFrom(() => store.rememberStatement({ pipelineResult: pipelineResult(rows(1, 2)), importedAt: IMPORTED_AT }), VaultError, "STORAGE_QUOTA_EXCEEDED");
});

test("test_persistence_failure_after_processing_rolls_back_the_whole_import", async () => {
  const { store, vault, environment, outcomes } = await remembered([pipelineResult(rows(1, 2))]);
  const raw = await dumpDatabases(environment.indexedDB);
  failWrites();
  await assert.rejects(() => store.rememberStatement({ pipelineResult: pipelineResult(rows(2, 4)), importedAt: LATER }));
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
  assert.equal((await vault.readLedger(outcomes[0].ledgerId)).ledger.statements.length, 1);
  assert.equal(store.currentLedger().statements.length, 1);
});

// G. Import flow as the user sees it (the data layer, src/data/repo.ts, with remember on)

/** An engine that answers each upload with the next result, as the statement engine would. */
function engineFor(results) {
  let runs = 0;
  return {
    async run() {
      const result = results[runs++ % results.length];
      const plan = { actions: [], counts: { new: result.transactions.length, matched: 0, collided: 0 } };
      return { ok: true, pipeline_result_json: JSON.stringify(result), plan_json: JSON.stringify(plan) };
    },
    async warm_up() {},
    cancel() {},
  };
}

/** The data layer with remember on, over a fresh store, answering uploads with `results`. */
async function rememberingRepo(results, environment = undefined) {
  const parts = await createdStore(core, environment);
  repo.useEngineForTests(engineFor(results));
  repo.rememberOnThisDevice(parts.store);
  return parts;
}

const statementFile = () => new File([new Uint8Array([1, 2, 3])], "statement.pdf", { type: "application/pdf" });

test("test_upload_persists_the_import_and_returns_its_analytics", async () => {
  const result = pipelineResult(rows(1, 3), { report: report(123) });
  const { store } = await rememberingRepo([result]);
  const created = await repo.uploadStatement(statementFile(), "");
  assert.deepEqual(created.analytics, report(123));
  assert.equal(store.currentLedger().statements.length, 1);
  assert.equal(created.import.id, store.currentLedger().statements[0].id);
});

test("test_verification_token_is_returned_but_never_stored", async () => {
  const { environment, store } = await rememberingRepo([pipelineResult(rows(1, 2))]);
  const created = await repo.uploadStatement(statementFile(), "");
  assert.equal(created.verification_token, TOKEN);
  assert.equal(JSON.stringify(store.currentLedger()).includes(TOKEN), false);
  assert.equal(holdsBytes(await dumpDatabases(environment.indexedDB), TOKEN), false);
});

test("test_stored_import_can_be_read_back", async () => {
  await rememberingRepo([pipelineResult(rows(1, 2))]);
  const created = await repo.uploadStatement(statementFile(), "");
  assert.deepEqual(await repo.getImport(created.import.id), created.import);
  assert.deepEqual((await repo.listImports()).items, [created.import]);
  assert.deepEqual((await repo.getAnalytics(created.import.id)).result, created.analytics);
});

test("test_transactions_match_the_engine_output", async () => {
  const result = pipelineResult(rows(1, 3));
  await rememberingRepo([result]);
  const created = await repo.uploadStatement(statementFile(), "");
  const transactions = await repo.getAllTransactions(created.import.id);
  assert.deepEqual(
    transactions.map((transaction) => [transaction.receipt_no, transaction.paid_out, transaction.transaction_status]),
    result.transactions.map((transaction) => [transaction.receipt_no, transaction.paid_out, transaction.status]),
  );
});

test("test_transactions_can_be_paged", async () => {
  await rememberingRepo([pipelineResult(rows(1, 5))]);
  const created = await repo.uploadStatement(statementFile(), "");
  const page = await repo.getTransactions(created.import.id, { limit: 2, offset: 2 });
  const all = await repo.getAllTransactions(created.import.id);
  assert.deepEqual(page, { items: all.slice(2, 4), total: 5, limit: 2, offset: 2 });
});

test("test_reupload_creates_a_new_import_without_duplicating_transactions", async () => {
  const result = pipelineResult(rows(1, 3));
  const { store } = await rememberingRepo([result, result]);
  const first = await repo.uploadStatement(statementFile(), "");
  const second = await repo.uploadStatement(statementFile(), "");
  assert.notEqual(first.import.id, second.import.id);
  assert.equal(second.import.previously_imported_transaction_count, 3);
  assert.equal(store.currentLedger().transactions.length, 3);
  assert.equal((await repo.listImports()).items.length, 2);
});

test("test_persistence_failure_returns_503_and_stores_nothing", async () => {
  const { environment } = await rememberingRepo([pipelineResult(rows(1, 2))]);
  const raw = await dumpDatabases(environment.indexedDB);
  failWrites();
  const error = await errorFrom(() => repo.uploadStatement(statementFile(), ""), repo.ApiError, "save_failed");
  assert.equal(error.status, 503);
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
});

test("test_imports_survive_an_application_restart", async () => {
  const { environment } = await rememberingRepo([pipelineResult(rows(1, 2))]);
  const created = await repo.uploadStatement(statementFile(), "");
  const restarted = await createdStore(core, environment);
  repo.useEngineForTests(engineFor([pipelineResult(rows(1, 2))]));
  repo.rememberOnThisDevice(restarted.store);
  await restarted.store.switchLedger(await restarted.vault.ledgerIdFor(DIGEST));
  assert.deepEqual((await repo.listImports()).items, [created.import]);
});

test("test_unknown_import_is_not_found", async () => {
  await rememberingRepo([pipelineResult(rows(1, 2))]);
  await repo.uploadStatement(statementFile(), "");
  await errorFrom(() => repo.getImport(999_999), repo.ApiError, "import_not_found");
});
