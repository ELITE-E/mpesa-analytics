// CP9a item 3: a changed or truncated blob is detected, reported and never partly shown (N-05);
// associated data binds each blob to its slot, its version counter and the schema version; an
// unknown newer schema version is refused with a clear message (N-30). Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-tamper.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { PASSPHRASE, TEST_ITERATIONS, dumpDatabases, vaultEnvironment } from "./support/vault-environment.mjs";

const { openVaultWithIterations, VAULT_DATABASE_NAME } = await import("../src/persistence/vault.ts");
const { VaultError } = await import("../src/persistence/vault-errors.ts");

const LEDGER = { transactions: [{ receipt_no: "ZZ" + "00AA11BB", paid_in: 1250.5, details: "Invented Shop" }] };
const OTHER_LEDGER = { transactions: [{ receipt_no: "ZZ" + "99YY88XX", paid_out: 40, details: "Invented Kiosk" }] };

/** A created vault holding two saved ledgers, then locked and reopened as a fresh tab would. */
async function savedVault() {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE);
  await vault.saveLedger("ledger-one", LEDGER);
  await vault.saveLedger("ledger-two", OTHER_LEDGER);
  vault.lock();
  return environment;
}

/** Open a fresh vault on the environment and unlock it. */
async function unlockedVault(environment) {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.unlock(PASSPHRASE);
  return vault;
}

/** Change one stored record outside the vault, as a person with the device's files could. */
async function rewriteRecord(factory, store, key, change) {
  const database = await new Promise((resolve, reject) => {
    const request = factory.open(VAULT_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = database.transaction(store, "readonly").objectStore(store).get(key);
  const current = await new Promise((resolve) => (read.onsuccess = () => resolve(read.result)));
  const transaction = database.transaction(store, "readwrite");
  const objectStore = transaction.objectStore(store);
  const changed = change(structuredClone(current));
  if (objectStore.keyPath) objectStore.put(changed);
  else objectStore.put(changed, key);
  await new Promise((resolve) => (transaction.oncomplete = resolve));
  database.close();
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

/** Assert a damaged-ledger report: coded, plain, holding no ledger value, nothing held. */
async function assertDamaged(vault, ledgerId) {
  const error = await vaultErrorFrom(() => vault.readLedger(ledgerId));
  assert.equal(error.code, "LEDGER_DAMAGED");
  for (const value of ["Invented Shop", "Invented Kiosk", "ZZ" + "00AA11BB", "1250.5"]) {
    assert.equal(error.message.includes(value), false, value);
  }
  assert.equal(vault.status().heldLedgers, 0, "a damaged ledger is never held, not even in part");
}

test("a blob with one changed byte is detected and nothing from it is shown", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => {
    record.ciphertext[3] ^= 0x01;
    return record;
  });
  await assertDamaged(await unlockedVault(environment), "ledger-one");
});

test("a changed IV is detected", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => {
    record.iv[0] ^= 0x80;
    return record;
  });
  await assertDamaged(await unlockedVault(environment), "ledger-one");
});

test("a truncated blob is detected", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => {
    record.ciphertext = record.ciphertext.slice(0, Math.floor(record.ciphertext.length / 2));
    return record;
  });
  await assertDamaged(await unlockedVault(environment), "ledger-one");
});

test("a blob cut shorter than its authentication tag is detected", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => {
    record.ciphertext = record.ciphertext.slice(0, 5);
    return record;
  });
  await assertDamaged(await unlockedVault(environment), "ledger-one");
});

test("a record whose blob fields are missing or of the wrong kind is reported as damaged", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => {
    record.iv = "not bytes";
    delete record.ciphertext;
    return record;
  });
  await assertDamaged(await unlockedVault(environment), "ledger-one");
});

test("a blob moved into another ledger's slot is detected: the slot is bound to the blob", async () => {
  const environment = await savedVault();
  const records = await dumpDatabases(environment.indexedDB);
  const moved = records.find((record) => record.key === "ledger-one").value;
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-two", (record) => ({
    ...record,
    iv: moved.iv,
    ciphertext: moved.ciphertext,
  }));
  await assertDamaged(await unlockedVault(environment), "ledger-two");
});

test("a changed version counter is detected: the counter is bound to the blob", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => ({ ...record, version: 7 }));
  await assertDamaged(await unlockedVault(environment), "ledger-one");
});

test("a damaged ledger does not stop the others being read", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => {
    record.ciphertext[0] ^= 0xff;
    return record;
  });
  const vault = await unlockedVault(environment);
  await assertDamaged(vault, "ledger-one");
  assert.deepEqual((await vault.readLedger("ledger-two")).ledger, OTHER_LEDGER);
});

test("a newer schema version in meta is refused with a clear message, and nothing is changed (N-30)", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "meta", "vault", (meta) => ({ ...meta, schema_version: 2 }));
  const before = await dumpDatabases(environment.indexedDB);
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  assert.equal(vault.status().storageProblem, "SCHEMA_TOO_NEW");
  const error = await vaultErrorFrom(() => vault.unlock(PASSPHRASE));
  assert.equal(error.code, "SCHEMA_TOO_NEW");
  assert.match(error.message, /newer version of the app/);
  assert.equal(vault.status().locked, true);
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
});

test("a ledger record of a newer schema version is refused, not guessed", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "ledgers", "ledger-one", (record) => ({ ...record, schema_version: 2 }));
  const vault = await unlockedVault(environment);
  const error = await vaultErrorFrom(() => vault.readLedger("ledger-one"));
  assert.equal(error.code, "SCHEMA_TOO_NEW");
  assert.equal(vault.status().heldLedgers, 0);
});

test("a database laid out by a newer app is refused with the same message, and create refuses too", async () => {
  const environment = vaultEnvironment();
  await new Promise((resolve, reject) => {
    const request = environment.indexedDB.open(VAULT_DATABASE_NAME, 5);
    request.onupgradeneeded = () => request.result.createObjectStore("future");
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  assert.equal(vault.status().storageProblem, "SCHEMA_TOO_NEW");
  assert.equal((await vaultErrorFrom(() => vault.unlock(PASSPHRASE))).code, "SCHEMA_TOO_NEW");
  assert.equal((await vaultErrorFrom(() => vault.create(PASSPHRASE))).code, "SCHEMA_TOO_NEW");
});

test("delete-all still clears a vault of a newer schema version", async () => {
  const environment = await savedVault();
  await rewriteRecord(environment.indexedDB, "meta", "vault", (meta) => ({ ...meta, schema_version: 2 }));
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.deleteAll();
  assert.deepEqual(await environment.indexedDB.databases(), []);
  assert.equal(vault.status().storageProblem, null);
});
