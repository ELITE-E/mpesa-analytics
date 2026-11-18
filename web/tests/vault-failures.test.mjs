// CP9a item 5: failure modes (N-28, N-29, N-32, N-33). Storage that is unavailable or blocked, or
// a quota error, gives a typed message and memory-only mode; a failed write leaves the previous
// saved blob intact; a stale tab cannot overwrite a newer save (compare-and-set on the version
// counter). Fake IndexedDB stands in for the browser's; real Chrome repeats the quota, blocked and
// two-tab cases in vault-chrome.test.mjs. Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-failures.test.mjs

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { IDBObjectStore } from "fake-indexeddb";

import { PASSPHRASE, TEST_ITERATIONS, dumpDatabases, vaultEnvironment } from "./support/vault-environment.mjs";

const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { VaultError } = await import("../src/persistence/vault-errors.ts");

const FIRST = { transactions: [{ details: "Invented Shop", paid_out: 120 }] };
const SECOND = { transactions: [{ details: "Invented Shop", paid_out: 120 }, { details: "Invented Kiosk", paid_in: 500 }] };
const THIRD = { transactions: [{ details: "Invented Market", paid_out: 75 }] };

const originalPut = IDBObjectStore.prototype.put;
afterEach(() => {
  IDBObjectStore.prototype.put = originalPut;
});

/** Make every IndexedDB put throw a DOMException with `name`, as the browser does when a write fails. */
function failPutsWith(name) {
  IDBObjectStore.prototype.put = function failingPut() {
    throw new DOMException("simulated storage failure", name);
  };
}

/** An IndexedDB factory that refuses everything, as a browser with storage blocked does. */
function blockedFactory() {
  const refuse = () => {
    throw new DOMException("storage blocked", "SecurityError");
  };
  return { databases: async () => refuse(), open: refuse, deleteDatabase: refuse, cmp: refuse };
}

/** A created, unlocked vault holding FIRST, over a fresh environment. */
async function vaultHoldingFirst() {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE);
  await vault.saveLedger("ledger-one", FIRST);
  return { vault, environment };
}

/** What a fresh tab reads from the device after unlocking. */
async function readFromFreshTab(environment, ledgerId) {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.unlock(PASSPHRASE);
  return vault.readLedger(ledgerId);
}

/** Run `action` and return the VaultError it throws. */
async function vaultErrorFrom(action) {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof VaultError, `expected a VaultError, got ${error}`);
    return error;
  }
  assert.fail("expected a VaultError");
}

test("with no IndexedDB at all the vault opens in memory-only mode and says why (N-32)", async () => {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, vaultEnvironment({ indexedDB: null }));
  assert.deepEqual(vault.status(), {
    mode: "memory_only",
    remember: false,
    locked: true,
    heldLedgers: 0,
    storageProblem: "STORAGE_UNAVAILABLE",
  });
});

test("blocked storage (a private window, or storage disabled) gives memory-only mode, not a crash", async () => {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, vaultEnvironment({ indexedDB: blockedFactory() }));
  assert.equal(vault.status().mode, "memory_only");
  assert.equal(vault.status().storageProblem, "STORAGE_UNAVAILABLE");
});

test("in memory-only mode, opting in is refused with a typed, plain message", async () => {
  const environment = vaultEnvironment({ indexedDB: blockedFactory() });
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  const error = await vaultErrorFrom(() => vault.create(PASSPHRASE));
  assert.equal(error.code, "STORAGE_UNAVAILABLE");
  assert.match(error.message, /private window/);
  assert.match(error.message, /still works/);
  assert.equal(environment.storageManager.requests, 0);
});

test("in memory-only mode, a save writes nothing and says so, so the app keeps working", async () => {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, vaultEnvironment({ indexedDB: blockedFactory() }));
  assert.deepEqual(await vault.saveLedger("ledger-one", FIRST), { saved: false, reason: "MEMORY_ONLY" });
});

test("in memory-only mode, delete-all has nothing to delete and succeeds", async () => {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, vaultEnvironment({ indexedDB: blockedFactory() }));
  await vault.deleteAll();
  assert.equal(vault.status().mode, "memory_only");
});

test("storage refused at the moment of opting in gives memory-only mode and remembers nothing", async () => {
  const environment = vaultEnvironment();
  environment.indexedDB.open = () => {
    throw new DOMException("storage blocked", "SecurityError");
  };
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  const error = await vaultErrorFrom(() => vault.create(PASSPHRASE));
  assert.equal(error.code, "STORAGE_UNAVAILABLE");
  assert.equal(vault.status().mode, "memory_only");
  assert.equal(vault.status().remember, false);
  assert.equal(vault.status().locked, true);
});

test("a quota error gives a typed message and memory-only mode, and the previous blob is intact (N-28, N-33)", async () => {
  const { vault, environment } = await vaultHoldingFirst();
  const before = await dumpDatabases(environment.indexedDB);
  failPutsWith("QuotaExceededError");
  const error = await vaultErrorFrom(() => vault.saveLedger("ledger-one", SECOND));
  assert.equal(error.code, "STORAGE_QUOTA_EXCEEDED");
  assert.match(error.message, /not enough storage space/);
  assert.match(error.message, /previous saved data is unchanged/);
  assert.equal(vault.status().mode, "memory_only");
  assert.equal(vault.status().storageProblem, "STORAGE_QUOTA_EXCEEDED");
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
  assert.deepEqual(await readFromFreshTab(environment, "ledger-one"), { ledger: FIRST, version: 1 });
});

test("after a quota error, later saves write nothing and say so, and reading still works", async () => {
  const { vault } = await vaultHoldingFirst();
  failPutsWith("QuotaExceededError");
  await vaultErrorFrom(() => vault.saveLedger("ledger-one", SECOND));
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await vault.saveLedger("ledger-one", THIRD), { saved: false, reason: "MEMORY_ONLY" });
  assert.deepEqual((await vault.readLedger("ledger-one")).ledger, FIRST);
});

test("any other failed write leaves the previous blob intact and keeps saving available", async () => {
  const { vault, environment } = await vaultHoldingFirst();
  const before = await dumpDatabases(environment.indexedDB);
  failPutsWith("UnknownError");
  const error = await vaultErrorFrom(() => vault.saveLedger("ledger-one", SECOND));
  assert.equal(error.code, "STORAGE_WRITE_FAILED");
  assert.equal(vault.status().mode, "persistent");
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
  assert.deepEqual(await vault.saveLedger("ledger-one", SECOND), { saved: true, version: 2 });
});

test("a stale tab cannot overwrite a newer save; it is told to reload (N-29)", async () => {
  const { environment } = await vaultHoldingFirst();
  const tabA = await openVaultWithIterations(TEST_ITERATIONS, environment);
  const tabB = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await tabA.unlock(PASSPHRASE);
  await tabB.unlock(PASSPHRASE);
  await tabA.readLedger("ledger-one");
  await tabB.readLedger("ledger-one");
  assert.deepEqual(await tabA.saveLedger("ledger-one", SECOND), { saved: true, version: 2 });
  const error = await vaultErrorFrom(() => tabB.saveLedger("ledger-one", THIRD));
  assert.equal(error.code, "STALE_LEDGER");
  assert.match(error.message, /Reload/);
  assert.deepEqual(await readFromFreshTab(environment, "ledger-one"), { ledger: SECOND, version: 2 });
});

test("after reading again, the stale tab can save on top of the newer version", async () => {
  const { environment } = await vaultHoldingFirst();
  const tabA = await openVaultWithIterations(TEST_ITERATIONS, environment);
  const tabB = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await tabA.unlock(PASSPHRASE);
  await tabB.unlock(PASSPHRASE);
  await tabA.readLedger("ledger-one");
  await tabB.readLedger("ledger-one");
  await tabA.saveLedger("ledger-one", SECOND);
  await vaultErrorFrom(() => tabB.saveLedger("ledger-one", THIRD));
  assert.deepEqual((await tabB.readLedger("ledger-one")).ledger, SECOND);
  assert.deepEqual(await tabB.saveLedger("ledger-one", THIRD), { saved: true, version: 3 });
});

test("a tab that never read a ledger cannot overwrite one another tab saved", async () => {
  const { environment } = await vaultHoldingFirst();
  const tabB = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await tabB.unlock(PASSPHRASE);
  const error = await vaultErrorFrom(() => tabB.saveLedger("ledger-one", THIRD));
  assert.equal(error.code, "STALE_LEDGER");
  assert.deepEqual(await readFromFreshTab(environment, "ledger-one"), { ledger: FIRST, version: 1 });
});

test("two tabs saving from the same version at once: exactly one wins, the other is stale", async () => {
  const { environment } = await vaultHoldingFirst();
  const tabA = await openVaultWithIterations(TEST_ITERATIONS, environment);
  const tabB = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await tabA.unlock(PASSPHRASE);
  await tabB.unlock(PASSPHRASE);
  await tabA.readLedger("ledger-one");
  await tabB.readLedger("ledger-one");
  const outcomes = await Promise.allSettled([tabA.saveLedger("ledger-one", SECOND), tabB.saveLedger("ledger-one", THIRD)]);
  const saved = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const stale = outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason.code === "STALE_LEDGER");
  assert.equal(saved.length, 1);
  assert.equal(stale.length, 1);
  assert.equal((await readFromFreshTab(environment, "ledger-one")).version, 2);
});

test("a stale save writes nothing at all", async () => {
  const { environment } = await vaultHoldingFirst();
  const tabB = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await tabB.unlock(PASSPHRASE);
  const before = await dumpDatabases(environment.indexedDB);
  await vaultErrorFrom(() => tabB.saveLedger("ledger-one", THIRD));
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
});
