// The encrypted vault behind "Remember on this device" (ADR 0016, docs/THREAT_MODEL.md). Off by
// default: until `create`, nothing is written. Once created, every ledger is one AES-GCM blob in
// IndexedDB under a key derived from the passphrase; the key lives only in this object's memory
// while unlocked. `lock` (by hand, after the idle time, or on delete-all) drops the key and every
// ledger the vault holds, and tells listeners to clear the screen.

import { findForbiddenContent } from "@/persistence/forbidden-content";
import { checkHint, checkPassphrase } from "@/persistence/passphrase-policy";
import {
  associatedDataFor,
  computeLedgerId,
  deriveVaultKeys,
  isSealedBlob,
  openBlob,
  randomSalt,
  sealBlob,
  type VaultKeys,
} from "@/persistence/vault-crypto";
import {
  compareAndPutLedger,
  deleteVaultDatabase,
  listLedgerRecordIds,
  openVaultDatabase,
  readLedgerRecord,
  readMeta,
  vaultDatabaseExists,
  writeMeta,
  type LedgerRecord,
  type VaultMeta,
} from "@/persistence/vault-database";
import { VaultError, type VaultErrorCode } from "@/persistence/vault-errors";

export { VAULT_DATABASE_NAME } from "@/persistence/vault-database";

/** The fewest PBKDF2 iterations the production vault derives or accepts a key with. */
export const PRODUCTION_KDF_ITERATIONS = 600_000;
/** The idle time after which an unlocked vault locks itself: ten minutes. */
export const DEFAULT_IDLE_LOCK_MS = 10 * 60 * 1000;
/** The schema version of what this app writes. A newer stored version is refused, never guessed. */
export const SCHEMA_VERSION = 1;

const KEY_CHECK_TEXT = "mpesa-analytics vault key check";
const KEY_CHECK_BINDING = { slot: "key_check", schemaVersion: SCHEMA_VERSION, version: 0 };

/** Timers, injectable so tests drive the idle lock with a manual clock. */
export type VaultTimers = {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** What the vault reaches outside itself. Each part defaults to the browser's own. */
export type VaultEnvironment = {
  indexedDB?: IDBFactory | null;
  crypto?: Crypto;
  storageManager?: { persist(): Promise<boolean> } | null;
  timers?: VaultTimers;
  idleLockMs?: number;
};

/**
 * Why the vault locked: by hand, after the idle time, because its data was deleted here, or
 * because another tab deleted or upgraded the database.
 */
export type LockReason = "manual" | "idle" | "deleted" | "elsewhere";

/** What the screen may show about the vault. Never a value from a ledger. */
export type VaultStatus = {
  mode: "persistent" | "memory_only";
  remember: boolean;
  locked: boolean;
  heldLedgers: number;
  storageProblem: VaultErrorCode | null;
};

/** A ledger as read: the decrypted ledger and the version counter it was saved under. */
export type LedgerRead = { ledger: unknown; version: number };

/**
 * The outcome of a save: saved under a version, or deliberately not saved because remember is off
 * or storage cannot be used (memory-only mode). Failures are thrown as VaultError instead.
 */
export type SaveOutcome = { saved: true; version: number } | { saved: false; reason: "REMEMBER_OFF" | "MEMORY_ONLY" };

/**
 * Open the vault for this browser, with the production key derivation (600,000 iterations).
 *
 * @param environment Replacements for the browser's IndexedDB, WebCrypto, storage manager and
 *   timers, and the idle time. Any other field is ignored, so nothing here lowers the iterations.
 * @returns The vault, locked. Side effects: lists IndexedDB databases; writes nothing.
 */
export function openVault(environment: VaultEnvironment = {}): Promise<Vault> {
  return Vault.open(PRODUCTION_KDF_ITERATIONS, environment);
}

/**
 * Open the vault with a chosen iteration count. For unit tests only, where 600,000 iterations
 * per key would make the suite slow; the app uses `openVault` (a guard test checks this).
 *
 * @param iterations PBKDF2 iterations for new vaults, and the fewest accepted when unlocking.
 * @param environment As for `openVault`.
 * @returns The vault, locked. Side effects: as for `openVault`.
 * @throws {RangeError} When `iterations` is not a positive whole number.
 */
export async function openVaultWithIterations(
  iterations: number,
  environment: VaultEnvironment = {},
): Promise<Vault> {
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new RangeError("iterations must be a positive whole number");
  }
  return Vault.open(iterations, environment);
}

/** The vault: create, unlock, lock, delete-all, and reading and saving ledgers while unlocked. */
export class Vault {
  readonly #iterations: number;
  readonly #factory: IDBFactory | null;
  readonly #crypto: Crypto;
  readonly #storageManager: { persist(): Promise<boolean> } | null;
  readonly #timers: VaultTimers;
  readonly #idleLockMs: number;
  readonly #lockListeners = new Set<(reason: LockReason) => void>();
  #database: IDBDatabase | null = null;
  #remember: boolean;
  #keys: VaultKeys | null = null;
  #heldLedgers = new Map<string, LedgerRead>();
  #idleTimer: unknown = null;
  #hintToShow: string | null = null;
  #storageProblem: VaultErrorCode | null = null;
  #mode: VaultStatus["mode"] = "persistent";

  /**
   * Use `openVault` instead.
   *
   * @param iterations PBKDF2 iterations.
   * @param environment The resolved environment.
   * @param remember Whether a vault already exists on this device.
   */
  private constructor(iterations: number, environment: Required<VaultEnvironment>, remember: boolean) {
    this.#iterations = iterations;
    this.#factory = environment.indexedDB;
    this.#crypto = environment.crypto;
    this.#storageManager = environment.storageManager;
    this.#timers = environment.timers;
    this.#idleLockMs = environment.idleLockMs;
    this.#remember = remember;
  }

  /**
   * Resolve the environment and find out whether a vault exists on this device.
   *
   * @param iterations PBKDF2 iterations.
   * @param environment Replacements for the browser's own parts.
   * @returns The vault, locked; in memory-only mode when the browser has no usable storage.
   *   Side effects: lists IndexedDB databases and reads meta if present.
   */
  static async open(iterations: number, environment: VaultEnvironment): Promise<Vault> {
    const vault = new Vault(iterations, resolveEnvironment(environment), false);
    try {
      await vault.#readSavedState();
    } catch {
      // Not swallowed: the browser refused storage, and the status now says so (memory-only mode).
      vault.#enterMemoryOnly("STORAGE_UNAVAILABLE");
    }
    return vault;
  }

  /**
   * What the screen may show about the vault.
   *
   * @returns Mode, whether data is remembered, whether locked, how many ledgers are held, and any
   *   storage problem. Side effects: none.
   */
  status(): VaultStatus {
    return {
      mode: this.#mode,
      remember: this.#remember,
      locked: this.#keys === null,
      heldLedgers: this.#heldLedgers.size,
      storageProblem: this.#storageProblem,
    };
  }

  /**
   * Turn "Remember on this device" on: check the passphrase and hint, ask the browser to keep the
   * storage, derive the key and write the meta record. The vault is unlocked afterwards.
   *
   * @param passphrase The new passphrase.
   * @param options `hint`: optional, shown only after a failed unlock.
   * @returns Resolves when the meta record is written. Side effects: creates the database,
   *   requests persistent storage, writes meta, starts the idle timer.
   * @throws {VaultError} A policy code, VAULT_EXISTS, SCHEMA_TOO_NEW, or STORAGE_UNAVAILABLE (the
   *   vault then stays in memory-only mode).
   */
  async create(passphrase: string, options: { hint?: string | null } = {}): Promise<void> {
    const passphraseVerdict = checkPassphrase(passphrase);
    if (!passphraseVerdict.ok) throw new VaultError(passphraseVerdict.code);
    const hintVerdict = checkHint(options.hint, passphrase);
    if (!hintVerdict.ok) throw new VaultError(hintVerdict.code);
    this.#refuseStorageProblem();
    if (this.#remember) throw new VaultError("VAULT_EXISTS");
    const database = await this.#connectionOrMemoryOnly();
    await this.#storageManager?.persist();
    const salt = randomSalt(this.#crypto);
    const keys = await deriveVaultKeys(this.#crypto, passphrase, salt, this.#iterations);
    const keyCheckText = new TextEncoder().encode(KEY_CHECK_TEXT);
    const keyCheck = await sealBlob(this.#crypto, keys.encryption, keyCheckText, associatedDataFor(KEY_CHECK_BINDING));
    const meta: VaultMeta = {
      schema_version: SCHEMA_VERSION,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: this.#iterations },
      salt,
      key_check: keyCheck,
      hint: hintVerdict.hint,
      remember_on_device: true,
    };
    try {
      await writeMeta(database, meta);
    } catch (error) {
      throw this.#writeFailure(error);
    }
    this.#remember = true;
    this.#becomeUnlocked(keys);
  }

  /**
   * Unlock with the passphrase. A wrong passphrase fails closed: the vault stays locked, nothing
   * is written, and the hint (if any) becomes available to show.
   *
   * @param passphrase The passphrase typed.
   * @returns Resolves when unlocked. Side effects: starts the idle timer.
   * @throws {VaultError} NO_VAULT, SCHEMA_TOO_NEW or WRONG_PASSPHRASE.
   */
  async unlock(passphrase: string): Promise<void> {
    const meta = await this.#readUsableMeta();
    const keys = await deriveVaultKeys(this.#crypto, passphrase, meta.salt, meta.kdf.iterations);
    try {
      await openBlob(this.#crypto, keys.encryption, meta.key_check, associatedDataFor(KEY_CHECK_BINDING));
    } catch (error) {
      this.#hintToShow = meta.hint;
      throw new VaultError("WRONG_PASSPHRASE", { cause: error });
    }
    this.#hintToShow = null;
    this.#becomeUnlocked(keys);
  }

  /**
   * The stored hint, only after the latest unlock attempt failed.
   *
   * @returns The hint, or null. Side effects: none.
   */
  hintAfterFailedUnlock(): string | null {
    return this.#hintToShow;
  }

  /**
   * Lock: drop the key and every held ledger, stop the idle timer, tell listeners.
   *
   * Side effects: notifies lock listeners with "manual".
   */
  lock(): void {
    this.#dropSecrets("manual");
  }

  /**
   * Note user activity: restarts the idle time while unlocked.
   *
   * Side effects: replaces the idle timer.
   */
  noteActivity(): void {
    if (this.#keys !== null) this.#restartIdleTimer();
  }

  /**
   * Listen for locks, so the screen can clear what it shows.
   *
   * @param listener Called with the reason on every lock.
   * @returns A function that stops listening. Side effects: registers the listener.
   */
  onLock(listener: (reason: LockReason) => void): () => void {
    this.#lockListeners.add(listener);
    return () => this.#lockListeners.delete(listener);
  }

  /**
   * The ledger id for an account: HMAC(ledger-id key, account digest), computed while unlocked.
   * The digest is used for this and never kept or stored; the id is the only account marker.
   *
   * @param accountDigest The pipeline result's account digest.
   * @returns 64 lowercase hex characters. Side effects: none.
   * @throws {VaultError} LOCKED, or ACCOUNT_DIGEST_INVALID for an empty or non-text digest.
   */
  async ledgerIdFor(accountDigest: string): Promise<string> {
    const keys = this.#requireKeys();
    if (typeof accountDigest !== "string" || accountDigest === "") throw new VaultError("ACCOUNT_DIGEST_INVALID");
    return computeLedgerId(this.#crypto, keys.ledgerId, accountDigest);
  }

  /**
   * The ids of every ledger saved on this device, while unlocked.
   *
   * @returns The ids; none when remember is off or storage cannot be used. Side effects: none.
   * @throws {VaultError} LOCKED.
   */
  async listLedgerIds(): Promise<string[]> {
    this.#requireKeys();
    if (!this.#remember || this.#mode === "memory_only") return [];
    return listLedgerRecordIds(await this.#connection());
  }

  /**
   * Read and decrypt one ledger.
   *
   * @param ledgerId The ledger id.
   * @returns The ledger and its version, or null if never saved. Side effects: holds the ledger
   *   until lock.
   * @throws {VaultError} LOCKED; SCHEMA_TOO_NEW for a record of a newer schema; LEDGER_DAMAGED when
   *   the blob was changed, truncated or moved. A damaged ledger is never returned or held in part.
   */
  async readLedger(ledgerId: string): Promise<LedgerRead | null> {
    const key = this.#requireKey();
    const record = await readLedgerRecord(await this.#connection(), ledgerId);
    if (record === undefined) return null;
    if (record.schema_version > SCHEMA_VERSION) throw new VaultError("SCHEMA_TOO_NEW");
    const read: LedgerRead = { ledger: await this.#decryptLedger(key, record), version: record.version };
    this.#heldLedgers.set(ledgerId, read);
    return read;
  }

  /**
   * Encrypt and save one whole ledger in one IndexedDB transaction. With "Remember on this device"
   * off, nothing is written and nothing is checked: the session stays in memory.
   *
   * @param ledgerId The ledger id.
   * @param ledger The whole ledger, JSON values only, holding nothing `findForbiddenContent` finds.
   * @returns The new version, or `{ saved: false, reason }` with REMEMBER_OFF or MEMORY_ONLY.
   *   Side effects: writes the ledgers store; holds the ledger. A quota error switches the vault to
   *   memory-only mode.
   * @throws {VaultError} LOCKED, or FORBIDDEN_CONTENT (with `detail`) before anything is written;
   *   STALE_LEDGER when another tab saved a newer version; STORAGE_QUOTA_EXCEEDED or
   *   STORAGE_WRITE_FAILED when the write fails. In every case the previous blob stays intact.
   */
  async saveLedger(ledgerId: string, ledger: unknown): Promise<SaveOutcome> {
    if (this.#mode === "memory_only") return { saved: false, reason: "MEMORY_ONLY" };
    if (!this.#remember) return { saved: false, reason: "REMEMBER_OFF" };
    const key = this.#requireKey();
    const forbidden = findForbiddenContent(ledger);
    if (forbidden !== null) throw new VaultError("FORBIDDEN_CONTENT", { detail: forbidden });
    const expectedVersion = this.#heldLedgers.get(ledgerId)?.version ?? 0;
    const version = expectedVersion + 1;
    const plaintext = new TextEncoder().encode(JSON.stringify(ledger));
    const binding = { slot: ledgerSlot(ledgerId), schemaVersion: SCHEMA_VERSION, version };
    const sealed = await sealBlob(this.#crypto, key, plaintext, associatedDataFor(binding));
    const record = { id: ledgerId, version, schema_version: SCHEMA_VERSION, ...sealed };
    let outcome: "written" | "stale";
    try {
      outcome = await compareAndPutLedger(await this.#connection(), record, expectedVersion);
    } catch (error) {
      throw this.#writeFailure(error);
    }
    if (outcome === "stale") throw new VaultError("STALE_LEDGER");
    this.#heldLedgers.set(ledgerId, { ledger, version });
    return { saved: true, version };
  }

  /**
   * Delete everything the vault stored: the whole database, then forget it was ever created.
   * Works while locked, for a person who forgot the passphrase.
   *
   * @returns Resolves once the database is gone. Side effects: locks (listeners hear "deleted"),
   *   closes the connection and deletes the database. With no usable storage there is nothing to
   *   delete.
   */
  async deleteAll(): Promise<void> {
    this.#dropSecrets("deleted");
    this.#database?.close();
    this.#database = null;
    if (this.#factory === null || this.#storageProblem === "STORAGE_UNAVAILABLE") return;
    await deleteVaultDatabase(this.#factory);
    this.#mode = "persistent";
    this.#remember = false;
    this.#hintToShow = null;
    this.#storageProblem = null;
  }

  /**
   * Find out whether a vault exists on this device and whether this app can read it, without
   * creating anything.
   *
   * @returns Resolves when known. Side effects: lists databases; opens the vault's if it exists.
   */
  async #readSavedState(): Promise<void> {
    if (this.#factory === null) throw new DOMException("no IndexedDB in this browser", "NotSupportedError");
    if (!(await vaultDatabaseExists(this.#factory))) return;
    this.#remember = true;
    let meta: VaultMeta | undefined;
    try {
      meta = await readMeta(await this.#connection());
    } catch (error) {
      if ((error as DOMException)?.name !== "VersionError") throw error;
      this.#storageProblem = "SCHEMA_TOO_NEW";
      return;
    }
    this.#remember = meta !== undefined;
    if (meta !== undefined && meta.schema_version > SCHEMA_VERSION) this.#storageProblem = "SCHEMA_TOO_NEW";
  }

  /**
   * The meta record of a vault this app can open.
   *
   * @returns The meta record. Side effects: reads meta.
   * @throws {VaultError} SCHEMA_TOO_NEW, NO_VAULT, or KDF_PARAMETERS_REFUSED when the stored key
   *   derivation is not PBKDF2-SHA256 with at least this vault's iteration count: a lowered count
   *   is refused, never followed.
   */
  async #readUsableMeta(): Promise<VaultMeta> {
    this.#refuseStorageProblem();
    if (!this.#remember) throw new VaultError("NO_VAULT");
    const meta = await readMeta(await this.#connection());
    if (meta === undefined) throw new VaultError("NO_VAULT");
    if (meta.schema_version > SCHEMA_VERSION) throw new VaultError("SCHEMA_TOO_NEW");
    if (!this.#acceptsKdf(meta.kdf)) throw new VaultError("KDF_PARAMETERS_REFUSED");
    return meta;
  }

  /**
   * Whether stored key-derivation parameters are ones this vault derives with.
   *
   * @param kdf The stored parameters.
   * @returns True for PBKDF2-SHA256 with a whole iteration count at or above this vault's.
   *   Side effects: none.
   */
  #acceptsKdf(kdf: VaultMeta["kdf"] | undefined): boolean {
    return (
      kdf?.name === "PBKDF2" &&
      kdf.hash === "SHA-256" &&
      Number.isSafeInteger(kdf.iterations) &&
      kdf.iterations >= this.#iterations
    );
  }

  /**
   * Refuse to go on while storage holds something this app cannot use.
   *
   * Side effects: none.
   *
   * @throws {VaultError} The stored problem, such as SCHEMA_TOO_NEW.
   */
  #refuseStorageProblem(): void {
    if (this.#storageProblem !== null) throw new VaultError(this.#storageProblem);
  }

  /**
   * Authenticate and decrypt one ledger record, all or nothing.
   *
   * @param key The vault key.
   * @param record The stored record.
   * @returns The ledger. Side effects: none.
   * @throws {VaultError} LEDGER_DAMAGED for any shape, authentication or decoding failure.
   */
  async #decryptLedger(key: CryptoKey, record: LedgerRecord): Promise<unknown> {
    if (!isSealedBlob(record)) throw new VaultError("LEDGER_DAMAGED");
    const binding = { slot: ledgerSlot(record.id), schemaVersion: record.schema_version, version: record.version };
    try {
      const plaintext = await openBlob(this.#crypto, key, record, associatedDataFor(binding));
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch (error) {
      throw new VaultError("LEDGER_DAMAGED", { cause: error });
    }
  }

  /**
   * Open the connection for opting in; if the browser refuses, switch to memory-only mode.
   *
   * @returns The connection. Side effects: may create the database.
   * @throws {VaultError} STORAGE_UNAVAILABLE.
   */
  async #connectionOrMemoryOnly(): Promise<IDBDatabase> {
    try {
      return await this.#connection();
    } catch (error) {
      this.#enterMemoryOnly("STORAGE_UNAVAILABLE");
      throw new VaultError("STORAGE_UNAVAILABLE", { cause: error });
    }
  }

  /**
   * The error to throw for a failed write. A quota error also switches to memory-only mode, so
   * the app keeps working without saving.
   *
   * @param error What IndexedDB threw or aborted with.
   * @returns STORAGE_QUOTA_EXCEEDED or STORAGE_WRITE_FAILED. Side effects: may change the mode.
   */
  #writeFailure(error: unknown): VaultError {
    if ((error as DOMException | null)?.name !== "QuotaExceededError") {
      return new VaultError("STORAGE_WRITE_FAILED", { cause: error });
    }
    this.#enterMemoryOnly("STORAGE_QUOTA_EXCEEDED");
    return new VaultError("STORAGE_QUOTA_EXCEEDED", { cause: error });
  }

  /**
   * Stop using storage for the rest of this page's life, keeping the reason for the screen.
   *
   * @param problem Why: STORAGE_UNAVAILABLE or STORAGE_QUOTA_EXCEEDED.
   * Side effects: changes the mode.
   */
  #enterMemoryOnly(problem: VaultErrorCode): void {
    this.#mode = "memory_only";
    this.#storageProblem = problem;
  }

  /**
   * The open connection, opened on first use. When another tab deletes or upgrades the database,
   * this connection closes so that tab is not blocked, and the vault locks.
   *
   * @returns The connection. Side effects: may create the database.
   */
  async #connection(): Promise<IDBDatabase> {
    if (this.#database !== null) return this.#database;
    const database = await openVaultDatabase(this.#factory as IDBFactory);
    database.onversionchange = () => {
      database.close();
      if (this.#database === database) this.#database = null;
      this.#dropSecrets("elsewhere");
    };
    this.#database = database;
    return database;
  }

  /**
   * The key, or LOCKED.
   *
   * @returns The key. Side effects: none.
   * @throws {VaultError} LOCKED.
   */
  #requireKey(): CryptoKey {
    return this.#requireKeys().encryption;
  }

  /**
   * Both keys, or LOCKED.
   *
   * @returns The keys. Side effects: none.
   * @throws {VaultError} LOCKED.
   */
  #requireKeys(): VaultKeys {
    if (this.#keys === null) throw new VaultError("LOCKED");
    return this.#keys;
  }

  /**
   * Hold the keys and start the idle timer.
   *
   * @param keys The derived keys. Side effects: starts the idle timer.
   */
  #becomeUnlocked(keys: VaultKeys): void {
    this.#keys = keys;
    this.#restartIdleTimer();
  }

  /**
   * Replace the idle timer with a fresh one.
   *
   * Side effects: clears and sets a timer.
   */
  #restartIdleTimer(): void {
    this.#stopIdleTimer();
    this.#idleTimer = this.#timers.setTimeout(() => this.#dropSecrets("idle"), this.#idleLockMs);
  }

  /**
   * Clear the idle timer, if any.
   *
   * Side effects: clears a timer.
   */
  #stopIdleTimer(): void {
    if (this.#idleTimer !== null) this.#timers.clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  /**
   * Drop the key and every held ledger, then tell listeners why.
   *
   * @param reason Why the vault locks. Side effects: clears the timer; calls listeners.
   */
  #dropSecrets(reason: LockReason): void {
    this.#stopIdleTimer();
    this.#keys = null;
    this.#heldLedgers = new Map();
    for (const listener of this.#lockListeners) listener(reason);
  }
}

/**
 * The slot name a ledger's blob is bound to.
 *
 * @param ledgerId The ledger id.
 * @returns "ledger:<id>". Side effects: none.
 */
function ledgerSlot(ledgerId: string): string {
  return `ledger:${ledgerId}`;
}

/**
 * Fill in the browser's own parts where the caller gave none.
 *
 * @param environment The caller's replacements.
 * @returns A complete environment. Side effects: reads globals.
 */
function resolveEnvironment(environment: VaultEnvironment): Required<VaultEnvironment> {
  return {
    indexedDB: environment.indexedDB === undefined ? globalThis.indexedDB : environment.indexedDB,
    crypto: environment.crypto ?? globalThis.crypto,
    storageManager:
      environment.storageManager === undefined ? (globalThis.navigator?.storage ?? null) : environment.storageManager,
    timers: environment.timers ?? {
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    idleLockMs: environment.idleLockMs ?? DEFAULT_IDLE_LOCK_MS,
  };
}
