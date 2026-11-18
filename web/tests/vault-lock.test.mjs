// CP9a item 2: create, unlock, lock, delete-all and the idle lock (N-01, N-04, N-06, N-08, N-09,
// N-11, N-16). Fake IndexedDB with Node's WebCrypto, a low iteration count and a manual clock.
// Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-lock.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OTHER_PASSPHRASE,
  PASSPHRASE,
  TEST_ITERATIONS,
  databaseNames,
  dumpDatabases,
  holdsBytes,
  holdsCryptoKey,
  vaultEnvironment,
} from "./support/vault-environment.mjs";

const { openVaultWithIterations, DEFAULT_IDLE_LOCK_MS, VAULT_DATABASE_NAME } = await import(
  "../src/persistence/vault.ts"
);
const { VaultError } = await import("../src/persistence/vault-errors.ts");

const LEDGER_ID = "ledger-one";
const LEDGER = { transactions: [{ receipt_no: "ZZ" + "00AA11BB", paid_in: 1250.5, details: "Invented Shop" }] };
const TEN_MINUTES = 10 * 60 * 1000;

/** A vault over a fresh environment, with the environment for assertions. */
async function freshVault(overrides = {}) {
  const environment = vaultEnvironment(overrides);
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  return { vault, environment };
}

/** A vault that has been created (and so is unlocked) with PASSPHRASE. */
async function createdVault(options = {}, overrides = {}) {
  const fresh = await freshVault(overrides);
  await fresh.vault.create(PASSPHRASE, options);
  return fresh;
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

test("a new vault remembers nothing, is locked and has written nothing", async () => {
  const { vault, environment } = await freshVault();
  assert.deepEqual(vault.status(), {
    mode: "persistent",
    remember: false,
    locked: true,
    heldLedgers: 0,
    storageProblem: null,
  });
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("create stores the KDF parameters, a 16-byte salt and a key check, and leaves the vault unlocked", async () => {
  const { vault, environment } = await createdVault();
  assert.deepEqual(vault.status(), {
    mode: "persistent",
    remember: true,
    locked: false,
    heldLedgers: 0,
    storageProblem: null,
  });
  const records = await dumpDatabases(environment.indexedDB);
  const meta = records.find((record) => record.store === "meta").value;
  assert.equal(meta.schema_version, 1);
  assert.deepEqual(meta.kdf, { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS });
  assert.ok(meta.salt instanceof Uint8Array);
  assert.equal(meta.salt.length, 16);
  assert.ok(meta.key_check.iv instanceof Uint8Array);
  assert.equal(meta.key_check.iv.length, 12);
  assert.ok(meta.key_check.ciphertext instanceof Uint8Array);
  assert.equal(meta.hint, null);
  assert.equal(meta.remember_on_device, true);
  assert.deepEqual(records.map((record) => record.database), [VAULT_DATABASE_NAME]);
});

test("the passphrase and the key are never stored (N-04)", async () => {
  const { vault, environment } = await createdVault({ hint: "the trip to the coast" });
  await vault.saveLedger(LEDGER_ID, LEDGER);
  const records = await dumpDatabases(environment.indexedDB);
  assert.equal(holdsBytes(records, PASSPHRASE), false);
  for (const word of PASSPHRASE.split(" ")) assert.equal(holdsBytes(records, word), false, word);
  assert.equal(holdsCryptoKey(records), false);
});

test("two vaults created with the same passphrase get different salts", async () => {
  const first = await createdVault();
  const second = await createdVault();
  const saltOf = async ({ environment }) =>
    (await dumpDatabases(environment.indexedDB)).find((record) => record.store === "meta").value.salt;
  assert.notDeepEqual(await saltOf(first), await saltOf(second));
});

test("create refuses a weak passphrase with the policy's code and writes nothing", async () => {
  const { vault, environment } = await freshVault();
  const error = await vaultErrorFrom(() => vault.create("lamp tree cup"));
  assert.equal(error.code, "PASSPHRASE_TOO_SHORT");
  assert.equal(error.message.includes("lamp"), false);
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
  assert.equal(vault.status().remember, false);
});

test("create refuses a hint holding a passphrase word and writes nothing", async () => {
  const { vault, environment } = await freshVault();
  const error = await vaultErrorFrom(() => vault.create(PASSPHRASE, { hint: "pebble" }));
  assert.equal(error.code, "HINT_CONTAINS_PASSPHRASE_WORD");
  assert.equal(error.message.includes("pebble"), false);
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("create refuses when a vault already exists on this device", async () => {
  const { vault } = await createdVault();
  const error = await vaultErrorFrom(() => vault.create(OTHER_PASSPHRASE));
  assert.equal(error.code, "VAULT_EXISTS");
});

test("a second vault opened on the same device sees the saved vault, locked", async () => {
  const { environment } = await createdVault();
  const later = await openVaultWithIterations(TEST_ITERATIONS, environment);
  assert.equal(later.status().remember, true);
  assert.equal(later.status().locked, true);
});

test("unlock with the right passphrase opens what was saved", async () => {
  const { vault, environment } = await createdVault();
  await vault.saveLedger(LEDGER_ID, LEDGER);
  const later = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await later.unlock(PASSPHRASE);
  assert.equal(later.status().locked, false);
  assert.deepEqual((await later.readLedger(LEDGER_ID)).ledger, LEDGER);
});

test("a ledger never saved reads as null", async () => {
  const { vault } = await createdVault();
  assert.equal(await vault.readLedger("never-saved"), null);
});

test("a wrong passphrase fails closed: coded error, no values, still locked, nothing written (N-01, N-08)", async () => {
  const { vault, environment } = await createdVault({ hint: "the trip to the coast" });
  await vault.saveLedger(LEDGER_ID, LEDGER);
  vault.lock();
  const before = await dumpDatabases(environment.indexedDB);
  const error = await vaultErrorFrom(() => vault.unlock(OTHER_PASSPHRASE));
  assert.equal(error.code, "WRONG_PASSPHRASE");
  for (const secret of [PASSPHRASE, OTHER_PASSPHRASE, "the trip to the coast", "Invented Shop"]) {
    assert.equal(error.message.includes(secret), false, secret);
    assert.equal(String(error.stack).includes(secret), false, secret);
  }
  assert.deepEqual(Object.keys(error).sort(), ["code"]);
  assert.equal(vault.status().locked, true);
  assert.equal((await vaultErrorFrom(() => vault.readLedger(LEDGER_ID))).code, "LOCKED");
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
});

test("unlock with no vault on the device says so", async () => {
  const { vault } = await freshVault();
  assert.equal((await vaultErrorFrom(() => vault.unlock(PASSPHRASE))).code, "NO_VAULT");
});

test("the hint is off by default: none is shown even after a failed unlock (N-09)", async () => {
  const { vault } = await createdVault();
  vault.lock();
  await vaultErrorFrom(() => vault.unlock(OTHER_PASSPHRASE));
  assert.equal(vault.hintAfterFailedUnlock(), null);
});

test("the hint is shown only after a failed unlock, and hidden again after a good one (N-11)", async () => {
  const { vault } = await createdVault({ hint: "the trip to the coast" });
  vault.lock();
  assert.equal(vault.hintAfterFailedUnlock(), null);
  await vaultErrorFrom(() => vault.unlock(OTHER_PASSPHRASE));
  assert.equal(vault.hintAfterFailedUnlock(), "the trip to the coast");
  await vault.unlock(PASSPHRASE);
  assert.equal(vault.hintAfterFailedUnlock(), null);
});

test("lock drops the key and every held ledger and tells listeners to clear the screen", async () => {
  const { vault } = await createdVault();
  await vault.saveLedger(LEDGER_ID, LEDGER);
  await vault.readLedger(LEDGER_ID);
  assert.equal(vault.status().heldLedgers, 1);
  const heard = [];
  vault.onLock((reason) => heard.push(reason));
  vault.lock();
  assert.deepEqual(heard, ["manual"]);
  assert.equal(vault.status().locked, true);
  assert.equal(vault.status().heldLedgers, 0);
  assert.equal((await vaultErrorFrom(() => vault.readLedger(LEDGER_ID))).code, "LOCKED");
  assert.equal((await vaultErrorFrom(() => vault.saveLedger(LEDGER_ID, LEDGER))).code, "LOCKED");
});

test("a listener can stop listening", async () => {
  const { vault } = await createdVault();
  const heard = [];
  const stop = vault.onLock((reason) => heard.push(reason));
  stop();
  vault.lock();
  assert.deepEqual(heard, []);
});

test("the idle lock defaults to ten minutes", () => {
  assert.equal(DEFAULT_IDLE_LOCK_MS, TEN_MINUTES);
});

test("the vault locks itself after ten idle minutes and clears the screen (N-06)", async () => {
  const { vault, environment } = await createdVault();
  await vault.saveLedger(LEDGER_ID, LEDGER);
  await vault.readLedger(LEDGER_ID);
  const heard = [];
  vault.onLock((reason) => heard.push(reason));
  environment.timers.advance(TEN_MINUTES - 1);
  assert.equal(vault.status().locked, false);
  environment.timers.advance(1);
  assert.equal(vault.status().locked, true);
  assert.equal(vault.status().heldLedgers, 0);
  assert.deepEqual(heard, ["idle"]);
});

test("any activity restarts the idle time", async () => {
  const { vault, environment } = await createdVault();
  environment.timers.advance(TEN_MINUTES - 1000);
  vault.noteActivity();
  environment.timers.advance(TEN_MINUTES - 1000);
  assert.equal(vault.status().locked, false);
  environment.timers.advance(1000);
  assert.equal(vault.status().locked, true);
});

test("the idle time can be set", async () => {
  const { vault, environment } = await createdVault({}, { idleLockMs: 5000 });
  environment.timers.advance(4999);
  assert.equal(vault.status().locked, false);
  environment.timers.advance(1);
  assert.equal(vault.status().locked, true);
});

test("an unlock restarts the idle time, and a lock leaves no timer behind", async () => {
  const { vault, environment } = await createdVault();
  vault.lock();
  assert.equal(environment.timers.pending(), 0);
  await vault.unlock(PASSPHRASE);
  assert.equal(environment.timers.pending(), 1);
  environment.timers.advance(TEN_MINUTES);
  assert.equal(vault.status().locked, true);
});

test("activity while locked does not start a timer", async () => {
  const { vault, environment } = await createdVault();
  vault.lock();
  vault.noteActivity();
  assert.equal(environment.timers.pending(), 0);
});

test("delete-all removes the whole database: ledgers, salt, hint and settings (N-16)", async () => {
  const { vault, environment } = await createdVault({ hint: "the trip to the coast" });
  await vault.saveLedger(LEDGER_ID, LEDGER);
  await vault.deleteAll();
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
  assert.deepEqual(vault.status(), {
    mode: "persistent",
    remember: false,
    locked: true,
    heldLedgers: 0,
    storageProblem: null,
  });
  const later = await openVaultWithIterations(TEST_ITERATIONS, environment);
  assert.equal(later.status().remember, false);
});

test("delete-all works while locked, for a person who forgot the passphrase", async () => {
  const { vault, environment } = await createdVault();
  vault.lock();
  await vault.deleteAll();
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("delete-all with nothing saved leaves storage empty", async () => {
  const { vault, environment } = await freshVault();
  await vault.deleteAll();
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("delete-all tells listeners to clear the screen", async () => {
  const { vault } = await createdVault();
  const heard = [];
  vault.onLock((reason) => heard.push(reason));
  await vault.deleteAll();
  assert.deepEqual(heard, ["deleted"]);
});

test("after delete-all a new vault can be created", async () => {
  const { vault } = await createdVault();
  await vault.deleteAll();
  await vault.create(OTHER_PASSPHRASE);
  assert.equal(vault.status().locked, false);
});

test("every save uses a fresh random 12-byte IV: no two saves, nor the key check, share one (N-03)", async () => {
  const { vault, environment } = await createdVault();
  const ivs = [];
  const metaIv = (await dumpDatabases(environment.indexedDB)).find((record) => record.store === "meta").value.key_check.iv;
  ivs.push(Buffer.from(metaIv).toString("hex"));
  for (let save = 0; save < 25; save += 1) {
    await vault.saveLedger(LEDGER_ID, LEDGER);
    const record = (await dumpDatabases(environment.indexedDB)).find((stored) => stored.key === LEDGER_ID).value;
    assert.equal(record.iv.length, 12);
    ivs.push(Buffer.from(record.iv).toString("hex"));
  }
  assert.equal(new Set(ivs).size, ivs.length);
});
