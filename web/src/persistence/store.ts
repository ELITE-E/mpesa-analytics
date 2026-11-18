// The browser store behind "Remember on this device" (ADR 0017): one encrypted ledger per
// account, merged statement by statement. The core decides (plan_statement_import, then
// validate_import_plan, through the bridge); this module applies the plan in JavaScript and
// saves the whole new ledger in one vault write, so a failure at any point leaves the saved
// ledger as it was. The account digest is used only to compute the ledger id and never kept.

import {
  applyStatementImport,
  coreRowsOf,
  deleteStatement as withoutStatement,
  emptyLedger,
  mergedAnalysisRequest,
  type ImportCounts,
  type ImportObservation,
  type ImportPlan,
  type Ledger,
  type Period,
  type PipelineResultForStore,
} from "@/persistence/ledger";
import type { MergedAnalysis, StoreCore } from "@/persistence/store-core";
import { StoreError } from "@/persistence/store-errors";
import type { Vault } from "@/persistence/vault";

/** Why a statement was not remembered: nothing was planned or written. */
export type NotRemembered = { saved: false; reason: "REMEMBER_OFF" | "MEMORY_ONLY" | "ACCOUNT_UNREADABLE" };

/** A statement remembered: its ledger, its id in that ledger and the plan's counts. */
export type Remembered = { saved: true; ledgerId: string; statementId: number; counts: ImportCounts };

/**
 * A merge worked out and checked but not written (N-26): the screen shows `counts`, then the
 * person confirms (one write) or cancels (nothing written).
 */
export type PreparedImport = {
  ledgerId: string;
  counts: ImportCounts;
  plan: ImportPlan;
  confirm(): Promise<Remembered>;
  cancel(): void;
};

/** One saved ledger, as a list of choices can show it. */
export type LedgerListing = { ledgerId: string; statementCount: number; period: Period };

/** Why the screen should redraw: a ledger was saved, another was switched to, or the vault locked. */
export type StoreChange = "saved" | "switched" | "locked";

/** What remembering a statement takes. */
export type RememberRequest = {
  pipelineResult: PipelineResultForStore & { account_digest?: string | null };
  /** The web layer's time; the core never reads a clock. */
  importedAt: string;
  /** A plan already made for these rows (the engine's run); the core validates it all the same. */
  plan?: unknown;
  /** For a statement whose account cannot be read: the saved ledger the person picked. */
  ledgerChoice?: string;
  observations?: ImportObservation[];
};

/**
 * The store over an opened vault.
 *
 * @param vault The vault; the store reads and saves ledgers through it.
 * @param core The core's plan, validate and merged-analysis calls.
 * @returns The store. Side effects: listens for the vault's locks.
 */
export function openLedgerStore(vault: Vault, core: StoreCore): LedgerStore {
  return new LedgerStore(vault, core);
}

/** Ledgers per account: remembering statements, switching, deleting and merged analytics. */
export class LedgerStore {
  readonly #vault: Vault;
  readonly #core: StoreCore;
  readonly #listeners = new Set<(change: StoreChange) => void>();
  #current: { ledgerId: string; ledger: Ledger } | null = null;

  /**
   * Use `openLedgerStore` instead.
   *
   * @param vault The vault.
   * @param core The core calls.
   */
  constructor(vault: Vault, core: StoreCore) {
    this.#vault = vault;
    this.#core = core;
    vault.onLock(() => {
      this.#current = null;
      this.#notify("locked");
    });
  }

  /**
   * Whether statements are being remembered now: remember is on, storage works and the vault is
   * unlocked.
   *
   * @returns True if a statement read now would be saved. Side effects: none.
   */
  isActive(): boolean {
    const status = this.#vault.status();
    return status.remember && status.mode === "persistent" && !status.locked;
  }

  /**
   * The ledger id for an account (N-18).
   *
   * @param accountDigest The pipeline result's account digest.
   * @returns The id. Side effects: none.
   * @throws {VaultError} LOCKED or ACCOUNT_DIGEST_INVALID.
   */
  ledgerIdForAccount(accountDigest: string): Promise<string> {
    return this.#vault.ledgerIdFor(accountDigest);
  }

  /**
   * Every saved ledger, for the person to pick one (N-21, N-22).
   *
   * @returns Each ledger's id, statement count and merged period. Side effects: decrypts each.
   * @throws {VaultError} LOCKED, LEDGER_DAMAGED.
   */
  async listLedgers(): Promise<LedgerListing[]> {
    const listings: LedgerListing[] = [];
    for (const ledgerId of await this.#vault.listLedgerIds()) {
      const ledger = (await this.#vault.readLedger(ledgerId))?.ledger as Ledger;
      listings.push({ ledgerId, statementCount: ledger.statements.length, period: spanOf(ledger) });
    }
    return listings;
  }

  /**
   * The ledger on screen, if any.
   *
   * @returns Its id, or null. Side effects: none.
   */
  currentLedgerId(): string | null {
    return this.#current?.ledgerId ?? null;
  }

  /**
   * The ledger on screen, as last read or saved, or null; null after a lock.
   *
   * @returns The ledger. Side effects: none.
   */
  currentLedger(): Ledger | null {
    return this.#current?.ledger ?? null;
  }

  /**
   * Show another saved ledger; the previous one leaves the screen (N-22).
   *
   * @param ledgerId A saved ledger's id.
   * @returns The ledger. Side effects: replaces the current ledger; notifies "switched".
   * @throws {VaultError} LOCKED, LEDGER_DAMAGED. {StoreError} LEDGER_NOT_FOUND.
   */
  async switchLedger(ledgerId: string): Promise<Ledger> {
    const read = await this.#vault.readLedger(ledgerId);
    if (read === null) throw new StoreError("LEDGER_NOT_FOUND");
    this.#current = { ledgerId, ledger: read.ledger as Ledger };
    this.#notify("switched");
    return this.#current.ledger;
  }

  /**
   * Listen for changes, so the screen can redraw or clear.
   *
   * @param listener Called with the reason.
   * @returns A function that stops listening. Side effects: registers the listener.
   */
  onChange(listener: (change: StoreChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Work out and check how a statement merges into its account's ledger, without writing.
   *
   * @param request The statement and the web layer's time; see `RememberRequest`.
   * @returns The prepared merge, or why nothing will be remembered (remember off, memory-only
   *   mode, or an unreadable account with no ledger picked). Side effects: reads the ledger; calls
   *   the core.
   * @throws {VaultError} LOCKED, LEDGER_DAMAGED. {StoreError} LEDGER_NOT_FOUND, PLAN_FAILED,
   *   PLAN_REFUSED (the core's code in `detail`), STATEMENT_INCOMPLETE, TRANSACTION_INCOMPLETE,
   *   UNKNOWN_OBSERVATION_CATEGORY.
   */
  async prepareStatementImport(request: RememberRequest): Promise<PreparedImport | NotRemembered> {
    const notRemembered = this.#whyNotRemembered();
    if (notRemembered) return notRemembered;
    const ledgerId = await this.#ledgerIdFor(request);
    if (ledgerId === null) return { saved: false, reason: "ACCOUNT_UNREADABLE" };
    const ledger = ((await this.#vault.readLedger(ledgerId))?.ledger as Ledger | undefined) ?? emptyLedger();
    const incoming = request.pipelineResult.transactions;
    const existing = coreRowsOf(ledger);
    const plan = request.plan ?? (await this.#core.planImport(incoming, existing));
    await this.#core.validateImportPlan(plan, incoming, existing);
    const applied = applyStatementImport(ledger, {
      pipelineResult: request.pipelineResult,
      plan: plan as ImportPlan,
      importedAt: request.importedAt,
      observations: request.observations,
    });
    return this.#prepared(ledgerId, plan as ImportPlan, applied);
  }

  /**
   * Remember a statement: prepare its merge and confirm it at once.
   *
   * @param request As for `prepareStatementImport`.
   * @returns What was remembered, or why nothing was. Side effects: one vault write.
   * @throws As `prepareStatementImport`, and the vault's write errors (STALE_LEDGER,
   *   STORAGE_QUOTA_EXCEEDED, STORAGE_WRITE_FAILED, FORBIDDEN_CONTENT).
   */
  async rememberStatement(request: RememberRequest): Promise<Remembered | NotRemembered> {
    const prepared = await this.prepareStatementImport(request);
    return "confirm" in prepared ? prepared.confirm() : prepared;
  }

  /**
   * Delete one statement of the ledger on screen, in one write (ADR 0017: with its links,
   * observations, snapshots and the transactions only it observed).
   *
   * @param statementId The statement.
   * @returns Resolves once saved. Side effects: one vault write; notifies "saved".
   * @throws {StoreError} STATEMENT_NOT_FOUND. {VaultError} LOCKED and the write errors.
   */
  async deleteStatement(statementId: number): Promise<void> {
    if (this.#current === null) throw new StoreError("STATEMENT_NOT_FOUND");
    const { ledgerId, ledger } = this.#current;
    await this.#save(ledgerId, withoutStatement(ledger, statementId));
  }

  /**
   * The report across every statement of the ledger on screen (ADR 0017).
   *
   * @returns The merged period, closing balance and report; null without a remembered statement.
   *   Side effects: calls the core.
   * @throws {StoreError} ANALYSIS_FAILED, with the core's code.
   */
  async mergedAnalytics(): Promise<MergedAnalysis | null> {
    const ledger = this.#current?.ledger;
    if (!ledger || ledger.statements.length === 0) return null;
    return this.#core.analyzeMerged(mergedAnalysisRequest(ledger));
  }

  /**
   * Why a statement would not be remembered now, if it would not.
   *
   * @returns The reason, or null when it would be. Side effects: none.
   */
  #whyNotRemembered(): NotRemembered | null {
    const status = this.#vault.status();
    if (status.mode === "memory_only") return { saved: false, reason: "MEMORY_ONLY" };
    if (!status.remember) return { saved: false, reason: "REMEMBER_OFF" };
    return null;
  }

  /**
   * The ledger a statement belongs to: its account's, or the one the person picked when its
   * account cannot be read.
   *
   * @param request The statement and the person's choice.
   * @returns The ledger id, or null when the account is unreadable and nothing was picked.
   *   Side effects: none.
   * @throws {StoreError} LEDGER_NOT_FOUND for a pick that is not a saved ledger. {VaultError} LOCKED.
   */
  async #ledgerIdFor(request: RememberRequest): Promise<string | null> {
    const digest = request.pipelineResult.account_digest;
    if (typeof digest === "string" && digest !== "") return this.#vault.ledgerIdFor(digest);
    if (request.ledgerChoice === undefined) return null;
    if (!(await this.#vault.listLedgerIds()).includes(request.ledgerChoice)) throw new StoreError("LEDGER_NOT_FOUND");
    return request.ledgerChoice;
  }

  /**
   * A prepared merge that writes at most once.
   *
   * @param ledgerId The ledger.
   * @param plan The validated plan.
   * @param applied The new ledger and the statement's id.
   * @returns The prepared merge. Side effects: none until confirmed.
   */
  #prepared(ledgerId: string, plan: ImportPlan, applied: { ledger: Ledger; statementId: number }): PreparedImport {
    let settled = false;
    const settle = () => {
      if (settled) throw new StoreError("IMPORT_ALREADY_SETTLED");
      settled = true;
    };
    return {
      ledgerId,
      counts: plan.counts,
      plan,
      confirm: async () => {
        settle();
        await this.#save(ledgerId, applied.ledger);
        return { saved: true, ledgerId, statementId: applied.statementId, counts: plan.counts };
      },
      cancel: () => {
        settled = true;
      },
    };
  }

  /**
   * Save a whole ledger in one write and show it.
   *
   * @param ledgerId The ledger.
   * @param ledger The new ledger.
   * @returns Resolves once saved. Side effects: one vault write; notifies "saved".
   * @throws The vault's write errors; the saved ledger and the screen are then unchanged.
   */
  async #save(ledgerId: string, ledger: Ledger): Promise<void> {
    await this.#vault.saveLedger(ledgerId, ledger);
    this.#current = { ledgerId, ledger };
    this.#notify("saved");
  }

  /**
   * Tell every listener.
   *
   * @param change Why. Side effects: calls the listeners.
   */
  #notify(change: StoreChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}

/**
 * The span of a ledger's statements: earliest start to latest end.
 *
 * @param ledger The ledger.
 * @returns The period. Side effects: none.
 */
function spanOf(ledger: Ledger): Period {
  const starts = ledger.statements.map((statement) => statement.period.start).filter((start): start is string => Boolean(start));
  const ends = ledger.statements.map((statement) => statement.period.end).filter((end): end is string => Boolean(end));
  return { start: starts.sort()[0] ?? null, end: ends.sort().at(-1) ?? null };
}
