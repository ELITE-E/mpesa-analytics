// CP9b items 1, 2, 3 and 5 at the store (N-18 to N-27, N-29, N-31): one ledger per account, the
// plan checked by the core before any write, the merge confirmed before it is written, one write
// per import, deletion, per-statement quality and merged analytics. Real core under CPython, fake
// IndexedDB, invented values.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/store-ledgers.test.ts

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startCpythonCore } from "./support/cpython-core.mjs";
import {
  DIGEST,
  IMPORTED_AT,
  LATER,
  OTHER_DIGEST,
  TOKEN,
  createdStore,
  pipelineResult,
  row,
  rows,
} from "./support/store-fixtures.mjs";
import { PASSPHRASE, dumpDatabases, holdsBytes } from "./support/vault-environment.mjs";

const ledger = await import("../src/persistence/ledger.ts");
const { StoreError } = await import("../src/persistence/store-errors.ts");
const { VaultError } = await import("../src/persistence/vault-errors.ts");

let core;
before(() => {
  core = startCpythonCore();
});
after(() => core.close());

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

/** Remember a result at IMPORTED_AT. */
function remember(store, result, extra = {}) {
  return store.rememberStatement({ pipelineResult: result, importedAt: IMPORTED_AT, ...extra });
}

test("the ledger id is HMAC(vault key, account digest), and it is the only account marker stored (N-18)", async () => {
  const { store, vault, environment } = await createdStore(core);
  const outcome = await remember(store, pipelineResult(rows(1, 2)));
  assert.equal(outcome.ledgerId, await vault.ledgerIdFor(DIGEST));
  assert.equal(await store.ledgerIdForAccount(DIGEST), outcome.ledgerId);
  const raw = await dumpDatabases(environment.indexedDB);
  assert.equal(holdsBytes(raw, DIGEST), false);
  assert.equal(JSON.stringify(store.currentLedger()).includes(DIGEST), false);
});

test("a statement from a different account opens a separate ledger and is never compared (N-19)", async () => {
  const { store } = await createdStore(core);
  const first = await remember(store, pipelineResult(rows(1, 3), { digest: DIGEST }));
  const before = core.calls.length;
  const second = await remember(store, pipelineResult(rows(2, 4), { digest: OTHER_DIGEST }));
  assert.notEqual(first.ledgerId, second.ledgerId);
  assert.deepEqual(second.counts, { new: 3, matched: 0, collided: 0 });
  assert.deepEqual(core.calls.slice(before), ["plan_statement_import", "validate_import_plan"]);
  const listed = await store.listLedgers();
  assert.deepEqual(listed.map((entry) => entry.ledgerId).sort(), [first.ledgerId, second.ledgerId].sort());
  assert.deepEqual(listed.map((entry) => entry.statementCount), [1, 1]);
});

test("a statement from the same account merges into its ledger (N-20)", async () => {
  const { store } = await createdStore(core);
  const first = await remember(store, pipelineResult(rows(1, 3)));
  const second = await remember(store, pipelineResult(rows(2, 4)));
  assert.equal(first.ledgerId, second.ledgerId);
  assert.deepEqual(second.counts, { new: 1, matched: 2, collided: 0 });
  assert.equal(store.currentLedger().statements.length, 2);
});

test("a statement with no readable account stays in memory only unless the person picks a ledger (N-21)", async () => {
  const { store, environment } = await createdStore(core);
  const raw = await dumpDatabases(environment.indexedDB);
  assert.deepEqual(await remember(store, pipelineResult(rows(1, 2), { digest: null })), { saved: false, reason: "ACCOUNT_UNREADABLE" });
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
});

test("a statement with no readable account merges into the ledger the person picks (N-21)", async () => {
  const { store } = await createdStore(core);
  const first = await remember(store, pipelineResult(rows(1, 2)));
  const picked = await remember(store, pipelineResult(rows(2, 3), { digest: null }), { ledgerChoice: first.ledgerId });
  assert.equal(picked.ledgerId, first.ledgerId);
  assert.deepEqual(picked.counts, { new: 1, matched: 1, collided: 0 });
});

test("picking a ledger that does not exist is refused and writes nothing (N-21)", async () => {
  const { store, environment } = await createdStore(core);
  const raw = await dumpDatabases(environment.indexedDB);
  await errorFrom(
    () => remember(store, pipelineResult(rows(1, 2), { digest: null }), { ledgerChoice: "f".repeat(64) }),
    StoreError,
    "LEDGER_NOT_FOUND",
  );
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
});

test("switching ledgers works only while unlocked, and the previous ledger leaves the screen (N-22)", async () => {
  const { store, vault } = await createdStore(core);
  const first = await remember(store, pipelineResult(rows(1, 2), { digest: DIGEST }));
  const second = await remember(store, pipelineResult(rows(5, 6), { digest: OTHER_DIGEST }));
  assert.equal(store.currentLedgerId(), second.ledgerId);
  const heard = [];
  store.onChange((reason) => heard.push([reason, store.currentLedgerId()]));
  await store.switchLedger(first.ledgerId);
  assert.equal(store.currentLedger().transactions[0].receipt_no, row(1).receipt_no);
  vault.lock();
  assert.equal(store.currentLedger(), null);
  assert.equal(store.currentLedgerId(), null);
  await errorFrom(() => store.switchLedger(second.ledgerId), VaultError, "LOCKED");
  await errorFrom(() => store.listLedgers(), VaultError, "LOCKED");
  assert.deepEqual(heard, [["switched", first.ledgerId], ["locked", null]]);
});

test("switching to a ledger that was never saved is refused", async () => {
  const { store } = await createdStore(core);
  await errorFrom(() => store.switchLedger("e".repeat(64)), StoreError, "LEDGER_NOT_FOUND");
});

test("the plan is checked by the core before any write: a plan for other rows is refused (N-23)", async () => {
  const { store, environment } = await createdStore(core);
  const raw = await dumpDatabases(environment.indexedDB);
  const stalePlan = { actions: [{ row_index: 0, action: "insert", target: null, collides_with: [], observation: null }], counts: { new: 1, matched: 0, collided: 0 } };
  const error = await errorFrom(() => remember(store, pipelineResult(rows(1, 2)), { plan: stalePlan }), StoreError, "PLAN_REFUSED");
  assert.ok(["ROW_ACTION_COUNT", "PLAN_MISMATCH"].includes(error.detail), error.detail);
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
});

test("a plan that is not shaped like a plan is refused (N-23)", async () => {
  const { store } = await createdStore(core);
  const error = await errorFrom(() => remember(store, pipelineResult(rows(1, 2)), { plan: { actions: "everything" } }), StoreError, "PLAN_REFUSED");
  assert.equal(error.message.includes("Example"), false);
});

test("the core validates every plan, its own included, before the write (N-23)", async () => {
  const { store } = await createdStore(core);
  const before = core.calls.length;
  await remember(store, pipelineResult(rows(1, 2)));
  assert.deepEqual(core.calls.slice(before), ["plan_statement_import", "validate_import_plan"]);
});

test("importing the same statement twice matches every row and inserts none (N-24)", async () => {
  const { store } = await createdStore(core);
  const statement = pipelineResult(rows(1, 4));
  await remember(store, statement);
  const again = await remember(store, statement);
  assert.deepEqual(again.counts, { new: 0, matched: 4, collided: 0 });
  assert.equal(store.currentLedger().transactions.length, 4);
});

test("overlapping statements insert only the new rows, and every row ends with exactly one action (N-25)", async () => {
  const { store } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 4)));
  const prepared = await store.prepareStatementImport({ pipelineResult: pipelineResult(rows(3, 7)), importedAt: LATER });
  assert.deepEqual(prepared.counts, { new: 3, matched: 2, collided: 0 });
  assert.equal(prepared.plan.actions.length, 5);
  assert.deepEqual(prepared.plan.actions.map((action) => action.row_index), [0, 1, 2, 3, 4]);
  await prepared.confirm();
  assert.equal(store.currentLedger().transactions.length, 7);
});

test("the merge shows its counts before the write, and cancel writes nothing (N-26)", async () => {
  const { store, environment } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 2)));
  const raw = await dumpDatabases(environment.indexedDB);
  const prepared = await store.prepareStatementImport({ pipelineResult: pipelineResult(rows(2, 3)), importedAt: LATER });
  assert.deepEqual(prepared.counts, { new: 1, matched: 1, collided: 0 });
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw, "nothing is written before confirmation");
  prepared.cancel();
  assert.deepEqual(await dumpDatabases(environment.indexedDB), raw);
  assert.equal(store.currentLedger().statements.length, 1);
  await errorFrom(() => prepared.confirm(), StoreError, "IMPORT_ALREADY_SETTLED");
});

test("confirming the merge writes it once; a second confirmation is refused (N-26)", async () => {
  const { store } = await createdStore(core);
  const prepared = await store.prepareStatementImport({ pipelineResult: pipelineResult(rows(1, 2)), importedAt: IMPORTED_AT });
  const confirmed = await prepared.confirm();
  assert.equal(confirmed.ledgerId, prepared.ledgerId);
  assert.equal(store.currentLedger().statements.length, 1);
  await errorFrom(() => prepared.confirm(), StoreError, "IMPORT_ALREADY_SETTLED");
});

test("a collision keeps both rows, records an observation, and the counts show it (N-27)", async () => {
  const { store } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 2)));
  const prepared = await store.prepareStatementImport({ pipelineResult: pipelineResult([row(2, { balance: 3 })]), importedAt: LATER });
  assert.deepEqual(prepared.counts, { new: 0, matched: 0, collided: 1 });
  await prepared.confirm();
  assert.equal(store.currentLedger().transactions.length, 3);
  assert.equal(store.currentLedger().observations.length, 1);
});

test("a stale tab's merge cannot overwrite a newer save (N-29)", async () => {
  const { store, environment } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 2)));
  const { store: otherTab } = await createdStore(core, environment);
  const mine = await store.prepareStatementImport({ pipelineResult: pipelineResult(rows(3, 3)), importedAt: LATER });
  const theirs = await otherTab.prepareStatementImport({ pipelineResult: pipelineResult(rows(4, 4)), importedAt: LATER });
  await theirs.confirm();
  await errorFrom(() => mine.confirm(), VaultError, "STALE_LEDGER");
});

test("per-statement quality is saved with the statement and read back after reload (N-31)", async () => {
  const { store, environment } = await createdStore(core);
  const outcome = await remember(store, pipelineResult(rows(1, 3), { chainBreaks: 2, totalsMatch: false, orientation: "newest_first" }));
  const { store: reloaded } = await createdStore(core, environment);
  await reloaded.switchLedger(outcome.ledgerId);
  const [statement] = reloaded.currentLedger().statements;
  assert.deepEqual(statement.quality, {
    row_count: 3,
    chain_breaks: 2,
    chain_orientation: "newest_first",
    totals_match: "no",
    unclassified_rows: 0,
    unclassified_share: 0,
  });
});

test("deleting a statement removes its links, observations, snapshot and the rows only it observed, in one write", async () => {
  const { store, vault } = await createdStore(core);
  const first = await remember(store, pipelineResult([row(1), row(2, { event_type: "UNCLASSIFIED" }), row(3)]));
  await remember(store, pipelineResult(rows(3, 4)));
  await store.deleteStatement(first.statementId);
  const held = store.currentLedger();
  assert.deepEqual(held.statements.map((statement) => statement.row_count), [2]);
  assert.deepEqual(held.transactions.map((stored) => stored.receipt_no), [row(3).receipt_no, row(4).receipt_no]);
  assert.equal(held.links.some((link) => link.statement_id === first.statementId), false);
  assert.deepEqual(held.observations, []);
  assert.equal(held.snapshots.length, 1);
  assert.deepEqual((await vault.readLedger(first.ledgerId)).ledger, held);
});

test("deleting a statement the ledger does not hold is refused", async () => {
  const { store } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 2)));
  await errorFrom(() => store.deleteStatement(999), StoreError, "STATEMENT_NOT_FOUND");
});

test("merged analytics run over each stored transaction once, with the union period and the closing rule", async () => {
  const { store } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 4)));
  await remember(store, pipelineResult(rows(3, 6)));
  const merged = await store.mergedAnalytics();
  assert.deepEqual(merged.period, { start: row(1).completion_time, end: row(6).completion_time });
  assert.equal(merged.closing_balance, row(6).balance);
  assert.equal(merged.report.cash_flow.total_outflow, 6 * 450);
});

test("merged analytics need at least one remembered statement", async () => {
  const { store } = await createdStore(core);
  assert.equal(await store.mergedAnalytics(), null);
});

test("after merging, the raw database holds no plaintext from the statements", async () => {
  const { store, environment } = await createdStore(core);
  await remember(store, pipelineResult(rows(1, 3)));
  await remember(store, pipelineResult([row(3), row(4, { balance: 9 })]));
  const raw = await dumpDatabases(environment.indexedDB);
  for (const value of [row(1).receipt_no, "Example Shop", "MERCHANT_PAYMENT", TOKEN, DIGEST, PASSPHRASE, "unexpected_receipt"]) {
    assert.equal(holdsBytes(raw, value), false, value);
  }
});

test("with remember off or storage refused, nothing is planned and nothing is written", async () => {
  const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
  const { openLedgerStore } = await import("../src/persistence/store.ts");
  const { storeCoreFrom } = await import("../src/persistence/store-core.ts");
  const { vaultEnvironment, TEST_ITERATIONS } = await import("./support/vault-environment.mjs");
  const vault = await openVaultWithIterations(TEST_ITERATIONS, vaultEnvironment());
  const store = openLedgerStore(vault, storeCoreFrom(core.call));
  const before = core.calls.length;
  assert.deepEqual(await remember(store, pipelineResult(rows(1, 2))), { saved: false, reason: "REMEMBER_OFF" });
  const blocked = await openVaultWithIterations(TEST_ITERATIONS, vaultEnvironment({ indexedDB: null }));
  assert.deepEqual(await remember(openLedgerStore(blocked, storeCoreFrom(core.call)), pipelineResult(rows(1, 2))), {
    saved: false,
    reason: "MEMORY_ONLY",
  });
  assert.equal(core.calls.length, before);
  assert.equal(ledger.LEDGER_FORMAT, 1);
});

test("in the app, the store reaches the core through the statement engine's call_core", async () => {
  const repo = await import("../src/data/repo.ts");
  const asked = [];
  repo.useEngineForTests({
    async run() {
      return { ok: false, failure: { code: "ENGINE_FAILED" } };
    },
    async call_core(functionName, requestText) {
      asked.push(functionName);
      return core.call(functionName, requestText);
    },
    async warm_up() {},
    cancel() {},
  });
  const { vault } = await createdStore(core);
  const { openLedgerStore } = await import("../src/persistence/store.ts");
  const engineStore = openLedgerStore(vault, repo.storeCoreForThisBrowser());
  await engineStore.rememberStatement({ pipelineResult: pipelineResult(rows(1, 2)), importedAt: IMPORTED_AT });
  assert.deepEqual(asked, ["plan_statement_import", "validate_import_plan"]);
});
