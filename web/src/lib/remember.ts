// The screens' handle on "Remember on this device" (CP9c, ADR 0016, ADR 0017): it opens the vault
// once, keeps the store the data layer reads while unlocked, and tells the screens what to show.
// Held in module memory only; the passphrase passes through to the vault and is never kept here.

import { rememberOnThisDevice, storeCoreForThisBrowser } from "@/data/repo";
import { rememberCard } from "@/content/remember";
import { openLedgerStore, type LedgerListing, type LedgerStore } from "@/persistence/store";
import type { StoreCore } from "@/persistence/store-core";
import { openVault, type LockReason, type Vault } from "@/persistence/vault";
import { VaultError } from "@/persistence/vault-errors";

/** What the screens show: whether remembering is off, locked or open, and why. */
export type RememberView = {
  phase: "starting" | "off" | "locked" | "unlocked" | "unavailable";
  /** Why storage cannot be used (memory-only mode), in plain words. */
  storageMessage: string | null;
  /** The hint, only after a wrong passphrase. */
  hint: string | null;
  /** Why it last locked: by hand, after the idle time, or from another tab. */
  lockReason: LockReason | null;
  /** "deleted" right after delete-all, until remembering is turned on again. */
  notice: "deleted" | null;
};

/** A refusal the screens show before anything reaches the vault. */
export class RememberProblem extends Error {
  readonly code: "PASSPHRASES_DIFFER";

  /**
   * Build the refusal with its copy.
   *
   * @param code Why.
   */
  constructor(code: "PASSPHRASES_DIFFER") {
    super(rememberCard.passphrasesDiffer);
    this.code = code;
  }
}

/** How to start: tests pass their own vault and core; the app uses the browser's. */
export type RememberOptions = { openVault?: () => Promise<Vault>; core?: StoreCore };

const STARTING: RememberView = { phase: "starting", storageMessage: null, hint: null, lockReason: null, notice: null };
const listeners = new Set<() => void>();
let session: { vault: Vault; store: LedgerStore } | null = null;
let view: RememberView = STARTING;
let started: Promise<void> | null = null;
let lockReason: LockReason | null = null;
let notice: RememberView["notice"] = null;

/**
 * Open the vault once and find out what this device holds. Writes nothing.
 *
 * @param options Test replacements for the vault and the core.
 * @returns Resolves once the view is known. Side effects: lists IndexedDB databases.
 */
export function startRemember(options: RememberOptions = {}): Promise<void> {
  started ??= open(options);
  return started;
}

/**
 * What the screens show now.
 *
 * @returns The view; the same object until something changes (for useSyncExternalStore).
 */
export function rememberView(): RememberView {
  return view;
}

/**
 * Be told when the view changes.
 *
 * @param listener Called after each change.
 * @returns A function that stops listening.
 */
export function subscribeRemember(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Turn remembering on: the passphrase typed twice, an optional hint. The vault checks the policy,
 * asks the browser to keep the storage, and is unlocked afterwards.
 *
 * @param request `passphrase`, `confirmation` and `hint` ("" for none).
 * @returns Resolves once on. Side effects: creates the vault's database.
 * @throws {RememberProblem} PASSPHRASES_DIFFER. {VaultError} the policy's codes, VAULT_EXISTS,
 *   STORAGE_UNAVAILABLE.
 */
export async function turnOnRemember(request: { passphrase: string; confirmation: string; hint: string }): Promise<void> {
  if (request.passphrase !== request.confirmation) throw new RememberProblem("PASSPHRASES_DIFFER");
  const { vault } = requireSession();
  try {
    await vault.create(request.passphrase, { hint: request.hint });
    notice = null;
  } finally {
    refresh();
  }
}

/**
 * Unlock with the passphrase and show the saved ledger with the latest statements. A wrong
 * passphrase changes nothing but the hint, which the screen may now show.
 *
 * @param passphrase The passphrase typed.
 * @returns Resolves once unlocked. Side effects: starts the idle timer; reads the ledgers.
 * @throws {VaultError} WRONG_PASSPHRASE, NO_VAULT, SCHEMA_TOO_NEW, KDF_PARAMETERS_REFUSED.
 */
export async function unlockRemember(passphrase: string): Promise<void> {
  const { vault } = requireSession();
  try {
    await vault.unlock(passphrase);
  } catch (error) {
    refresh();
    throw error;
  }
  lockReason = null;
  await showLatestLedger();
  refresh();
}

/**
 * Lock now: the key and the ledger on screen are dropped.
 *
 * Side effects: the vault notifies its listeners; the view becomes "locked".
 */
export function lockRemember(): void {
  session?.vault.lock();
}

/**
 * Note activity (a tap, a key): restarts the idle time while unlocked.
 *
 * Side effects: replaces the vault's idle timer.
 */
export function noteRememberActivity(): void {
  session?.vault.noteActivity();
}

/**
 * Delete everything this app saved on this device; works while locked, for a forgotten
 * passphrase. Remembering is off afterwards.
 *
 * @returns Resolves once the database is gone. Side effects: deletes the vault's database.
 */
export async function deleteEverything(): Promise<void> {
  const { vault } = requireSession();
  await vault.deleteAll();
  lockReason = null;
  notice = "deleted";
  refresh();
}

/**
 * Show another saved ledger (N-22); the one on screen leaves it.
 *
 * @param ledgerId A saved ledger's id.
 * @returns Resolves once switched. Side effects: the store tells its listeners.
 * @throws {VaultError} LOCKED, LEDGER_DAMAGED. {StoreError} LEDGER_NOT_FOUND.
 */
export async function switchLedger(ledgerId: string): Promise<void> {
  await requireSession().store.switchLedger(ledgerId);
  notify();
}

/**
 * Remove one statement of the ledger on screen, in one write: its links, observations and
 * snapshot, and the transactions no other statement printed (ADR 0017, P-1).
 *
 * @param statementId The statement's id.
 * @returns Resolves once saved. Side effects: one vault write.
 * @throws {StoreError} STATEMENT_NOT_FOUND. {VaultError} LOCKED and the write errors.
 */
export async function removeStatement(statementId: number): Promise<void> {
  await requireSession().store.deleteStatement(statementId);
  notify();
}

/**
 * Every saved ledger and the one on screen, for the switcher.
 *
 * @returns The listings and the shown ledger's id. Side effects: decrypts each ledger.
 * @throws {VaultError} LOCKED.
 */
export async function rememberedLedgers(): Promise<{ ledgers: LedgerListing[]; currentLedgerId: string | null }> {
  const { store } = requireSession();
  return { ledgers: await store.listLedgers(), currentLedgerId: store.currentLedgerId() };
}

/**
 * The store the controller opened: for tests only.
 *
 * @returns The store.
 * @throws {VaultError} STORAGE_UNAVAILABLE before it has opened.
 */
export function rememberedStoreForTests(): LedgerStore {
  return requireSession().store;
}

/**
 * Forget the session: for tests only.
 *
 * Side effects: stops remembering in the data layer.
 */
export function resetRememberForTests(): void {
  session = null;
  started = null;
  lockReason = null;
  notice = null;
  view = STARTING;
  rememberOnThisDevice(null);
  notify();
}

/**
 * Open the vault and the store and hand the store to the data layer.
 *
 * @param options Test replacements.
 * @returns Resolves once the view is known. Side effects: as `startRemember`.
 */
async function open(options: RememberOptions): Promise<void> {
  const vault = await (options.openVault ?? (() => openVault()))();
  const store = openLedgerStore(vault, options.core ?? storeCoreForThisBrowser());
  session = { vault, store };
  vault.onLock((reason) => {
    if (session?.vault !== vault) return;
    lockReason = reason === "deleted" ? null : reason;
    refresh();
  });
  rememberOnThisDevice(store);
  refresh();
}

/**
 * Show the saved ledger whose statements end latest, if any.
 *
 * @returns Resolves once switched. Side effects: decrypts each ledger to compare them.
 */
async function showLatestLedger(): Promise<void> {
  const { store } = requireSession();
  const ledgers = await store.listLedgers();
  const latest = [...ledgers].sort((first, second) => (first.period.end ?? "").localeCompare(second.period.end ?? "")).at(-1);
  if (latest) await store.switchLedger(latest.ledgerId);
}

/**
 * The open session.
 *
 * @returns It. Side effects: none.
 * @throws {VaultError} STORAGE_UNAVAILABLE before the vault has opened.
 */
function requireSession(): { vault: Vault; store: LedgerStore } {
  if (session === null) throw new VaultError("STORAGE_UNAVAILABLE");
  return session;
}

/**
 * Work out the view from the vault's status and tell listeners if it changed.
 *
 * Side effects: may notify listeners.
 */
function refresh(): void {
  if (session === null) return;
  const status = session.vault.status();
  const problem = status.storageProblem;
  const phase: RememberView["phase"] =
    status.mode === "memory_only" ? "unavailable" : !status.remember ? "off" : status.locked ? "locked" : "unlocked";
  const storageMessage = problem ? new VaultError(problem).message : null;
  const hint = phase === "locked" ? session.vault.hintAfterFailedUnlock() : null;
  const reason = phase === "locked" ? lockReason : null;
  const unchanged =
    phase === view.phase &&
    storageMessage === view.storageMessage &&
    hint === view.hint &&
    reason === view.lockReason &&
    notice === view.notice;
  if (unchanged) return;
  view = { phase, storageMessage, hint, lockReason: reason, notice };
  notify();
}

/**
 * Tell every listener.
 *
 * Side effects: calls the listeners.
 */
function notify(): void {
  for (const listener of listeners) listener();
}

export type { LockReason };



