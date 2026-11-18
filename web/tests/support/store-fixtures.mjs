// Invented records for the store's tests (CP9b): transactions shaped as the core gives them,
// pipeline results around them, and a store over a fresh fake IndexedDB with the real core under
// CPython. Every receipt is in the fake range, every name starts "Example", every number masked.

import { PASSPHRASE, TEST_ITERATIONS, vaultEnvironment } from "./vault-environment.mjs";

export const DIGEST = "5e1f".repeat(16);
export const OTHER_DIGEST = "a07c".repeat(16);
export const TOKEN = "QX7" + "M2KP9";
export const IMPORTED_AT = "2026-11-18T09:00:00Z";
export const LATER = "2026-11-19T09:00:00Z";

/**
 * One invented transaction, numbered so receipts, times and balances differ.
 *
 * @param {number} number Its number.
 * @param {object} [changes] Fields to replace.
 * @returns {object} A transaction as the core gives it (ClassifiedRow).
 */
export function row(number, changes = {}) {
  return {
    receipt_no: "ZZ" + `REC${String(number).padStart(5, "0")}`,
    completion_time: `2026-01-${String((number % 28) + 1).padStart(2, "0")} 10:00:00`,
    details: `Merchant Payment Online to 555123 Example Shop ${number}`,
    status: "Completed",
    paid_in: 0,
    withdrawn: 450,
    paid_out: 450,
    balance: 1000 + number,
    event_type: "MERCHANT_PAYMENT",
    cash_flow_direction: "OUTFLOW",
    economic_meaning: "CONSUMPTION",
    total_cost: 450,
    entity: `Example Shop ${number}`,
    ...changes,
  };
}

/**
 * Rows numbered first to last inclusive, oldest first.
 *
 * @param {number} first First number.
 * @param {number} last Last number.
 * @returns {object[]} The rows.
 */
export function rows(first, last) {
  return Array.from({ length: last - first + 1 }, (_, offset) => row(first + offset));
}

/** A small invented report; the store keeps it as given. */
export function report(total = 900) {
  return {
    cash_flow: { total_inflow: 0, total_outflow: total, net_cash_flow: -total, closing_balance: 1000 },
    spending: { monthly_expenditure: [{ month: "2026-01", expenditure: total }] },
  };
}

/**
 * A pipeline result around some transactions.
 *
 * @param {object[]} transactions The statement's transactions, in print order.
 * @param {object} [options] `digest` (null for an unreadable account), `report` (null for none),
 *   `processedAt`, `orientation`, `chainBreaks`, `totalsMatch`.
 * @returns {object} A PipelineResult.
 */
export function pipelineResult(transactions, options = {}) {
  const times = transactions.map((transaction) => transaction.completion_time).filter(Boolean).sort();
  const unclassified = transactions.filter((transaction) => transaction.event_type === "UNCLASSIFIED").length;
  const totalsMatch = options.totalsMatch ?? true;
  return {
    schema_version: 1,
    verification_token: TOKEN,
    verification_instruction: "To verify, dial *334# and choose Statement",
    account_digest: options.digest === undefined ? DIGEST : options.digest,
    processed_at: options.processedAt ?? IMPORTED_AT,
    period: { start: times[0] ?? null, end: times.at(-1) ?? null },
    balances: { opening_balance: null, closing_balance: transactions.at(-1)?.balance ?? null },
    transactions,
    report: options.report === undefined ? report() : options.report,
    quality: {
      row_count: transactions.length,
      chain_breaks: options.chainBreaks ?? 0,
      chain_orientation: options.orientation ?? "oldest_first",
      summary_total_paid_in_matches: totalsMatch,
      summary_total_paid_out_matches: totalsMatch,
      unclassified_rows: unclassified,
      unclassified_share: transactions.length ? unclassified / transactions.length : 0,
      account_number_unreadable: options.digest === null,
    },
    diagnostics: [],
  };
}

/**
 * A created, unlocked vault and a store over it, sharing one fake IndexedDB.
 *
 * @param {object} core A started CPython core (support/cpython-core.mjs).
 * @param {object} [environment] An existing environment, to reopen a device's storage.
 * @returns {Promise<{vault: object, store: object, environment: object}>} The parts.
 */
export async function createdStore(core, environment = vaultEnvironment()) {
  const { openVaultWithIterations } = await import("../../src/persistence/vault.ts");
  const { openLedgerStore } = await import("../../src/persistence/store.ts");
  const { storeCoreFrom } = await import("../../src/persistence/store-core.ts");
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  if (vault.status().remember) await vault.unlock(PASSPHRASE);
  else await vault.create(PASSPHRASE);
  return { vault, store: openLedgerStore(vault, storeCoreFrom(core.call)), environment };
}
