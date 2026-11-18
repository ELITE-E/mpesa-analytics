// IndexedDB access for the vault (ADR 0016): one database with two stores. `meta` holds one
// plaintext record (schema version, KDF parameters, salt, key check, optional hint, remember flag);
// `ledgers` holds one encrypted blob per ledger id with a version counter. Every write is one
// IndexedDB transaction. Nothing here decrypts or reads a passphrase.

import type { SealedBlob } from "@/persistence/vault-crypto";

/** The database's name. Delete-all deletes this database and nothing else exists. */
export const VAULT_DATABASE_NAME = "mpesa-analytics-vault";
/** The IndexedDB version of the database's layout (its stores), not the data's schema version. */
const DATABASE_VERSION = 1;
const META_STORE = "meta";
const LEDGER_STORE = "ledgers";
const META_KEY = "vault";

/** The plaintext record in `meta`. */
export type VaultMeta = {
  schema_version: number;
  kdf: { name: string; hash: string; iterations: number };
  salt: Uint8Array;
  key_check: SealedBlob;
  hint: string | null;
  remember_on_device: true;
};

/** One ledger as stored: its id, its version counter and its sealed blob. */
export type LedgerRecord = SealedBlob & { id: string; version: number; schema_version: number };

/**
 * Whether the vault's database exists, without creating it.
 *
 * @param factory The IndexedDB factory.
 * @returns True if it exists. Side effects: none.
 */
export async function vaultDatabaseExists(factory: IDBFactory): Promise<boolean> {
  const databases = await factory.databases();
  return databases.some((database) => database.name === VAULT_DATABASE_NAME);
}

/**
 * Open the vault's database, creating its two stores on first use.
 *
 * @param factory The IndexedDB factory.
 * @returns The open connection. Side effects: creates the database if it does not exist.
 * @throws {DOMException} When the browser refuses to open it.
 */
export function openVaultDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(VAULT_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(META_STORE);
      request.result.createObjectStore(LEDGER_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException("database open blocked", "InvalidStateError"));
  });
}

/**
 * Read the meta record.
 *
 * @param database The open connection.
 * @returns The record, or undefined when none was written. Side effects: none.
 */
export function readMeta(database: IDBDatabase): Promise<VaultMeta | undefined> {
  const transaction = database.transaction(META_STORE, "readonly");
  return requestResult(transaction.objectStore(META_STORE).get(META_KEY));
}

/**
 * Write the meta record in one transaction.
 *
 * @param database The open connection.
 * @param meta The record.
 * @returns Resolves when the transaction commits. Side effects: writes the meta store.
 */
export function writeMeta(database: IDBDatabase, meta: VaultMeta): Promise<void> {
  const transaction = database.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put(meta, META_KEY);
  return transactionDone(transaction);
}

/**
 * Read one ledger record.
 *
 * @param database The open connection.
 * @param ledgerId The ledger id.
 * @returns The record, or undefined. Side effects: none.
 */
export function readLedgerRecord(database: IDBDatabase, ledgerId: string): Promise<LedgerRecord | undefined> {
  const transaction = database.transaction(LEDGER_STORE, "readonly");
  return requestResult(transaction.objectStore(LEDGER_STORE).get(ledgerId));
}

/**
 * Write one ledger record in one transaction, only if the stored version counter is still the one
 * the caller read (compare-and-set). Reading the counter and writing happen in the same
 * transaction, which IndexedDB runs alone on the store, so two tabs cannot both win.
 *
 * @param database The open connection.
 * @param record The record to store; its `version` is the new counter.
 * @param expectedVersion The counter the caller read: 0 for a ledger it never read.
 * @returns "written", or "stale" when another save came first (nothing is written then).
 *   Side effects: writes the ledgers store.
 * @throws {DOMException} When the write fails (QuotaExceededError and others); the transaction
 *   aborts and the previous record stays as it was.
 */
export function compareAndPutLedger(
  database: IDBDatabase,
  record: LedgerRecord,
  expectedVersion: number,
): Promise<"written" | "stale"> {
  const transaction = database.transaction(LEDGER_STORE, "readwrite");
  const store = transaction.objectStore(LEDGER_STORE);
  let outcome: "written" | "stale" = "written";
  let writeError: unknown = null;
  const current = store.get(record.id);
  current.onsuccess = () => {
    const storedVersion = (current.result as LedgerRecord | undefined)?.version ?? 0;
    if (storedVersion !== expectedVersion) {
      outcome = "stale";
      transaction.abort();
      return;
    }
    try {
      store.put(record);
    } catch (error) {
      writeError = error;
      transaction.abort();
    }
  };
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(outcome);
    transaction.onabort = () => (outcome === "stale" ? resolve("stale") : reject(writeError ?? transaction.error));
  });
}

/**
 * Delete the vault's database: every ledger, the salt, the hint and the settings.
 *
 * @param factory The IndexedDB factory.
 * @returns Resolves once it is gone. Side effects: deletes the database.
 * @throws {DOMException} When the browser refuses.
 */
export function deleteVaultDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(VAULT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * The outcome of one request.
 *
 * @param request The request.
 * @returns Its result. Side effects: none.
 */
function requestResult<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Settle when a transaction commits, or reject with the reason it aborted.
 *
 * @param transaction The transaction.
 * @returns Resolves on commit. Side effects: none.
 */
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
