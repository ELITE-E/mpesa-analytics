// A stand-in for the statement engine, for tests at the data layer's seam (src/data/repo.ts) and
// for the browser tests' fake worker: it answers an upload with a contract scenario's pipeline
// result, built from the scenario's generated ledger (tests/fixtures/synthetic/<name>.api.json)
// and, where one is recorded, the core's report on it (<name>.report.json). No Python runs.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES } from "./contract-fixtures.mjs";

const NO_ENTITY = "NO_ENTITY_IDENTIFIED";
const TOKEN = "QX7" + "M2KP9";
const PROCESSED_AT = "2026-11-17T09:00:00Z";

/**
 * A scenario's ledger, freshly parsed.
 *
 * @param {string} name The scenario's name.
 * @returns {object} The ledger.
 */
function ledgerOf(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.api.json`), "utf8"));
}

/**
 * The pipeline result the core would give for a scenario: its transactions in print order
 * (newest first), the core's recorded report or else the ledger's totals, and quality counts.
 *
 * @param {string} name The scenario's name.
 * @returns {object} A PipelineResult.
 */
export function scenarioPipelineResult(name) {
  const ledger = ledgerOf(name);
  const reportFile = join(FIXTURES, `${name}.report.json`);
  const report = existsSync(reportFile)
    ? JSON.parse(readFileSync(reportFile, "utf8")).report
    : ledger.snapshot.result;
  const rows = ledger.rows;
  const unclassified = rows.filter((row) => row.event_type === "UNCLASSIFIED").length;
  return {
    schema_version: 1,
    verification_token: TOKEN,
    verification_instruction: null,
    account_digest: null,
    processed_at: PROCESSED_AT,
    period: { start: rows[0].completion_time, end: rows.at(-1).completion_time },
    balances: { opening_balance: null, closing_balance: rows.at(-1).balance },
    transactions: [...rows].reverse().map((row) => ({
      receipt_no: row.receipt_no,
      completion_time: row.completion_time,
      details: row.details,
      status: row.transaction_status,
      paid_in: row.paid_in,
      withdrawn: row.paid_out,
      paid_out: row.paid_out,
      balance: row.balance,
      event_type: row.event_type,
      cash_flow_direction: row.cash_flow_direction,
      economic_meaning: row.economic_meaning,
      total_cost: row.total_cost,
      entity: row.entity === NO_ENTITY ? null : row.entity,
    })),
    report,
    quality: {
      row_count: rows.length,
      chain_breaks: 0,
      summary_total_paid_in_matches: true,
      summary_total_paid_out_matches: true,
      unclassified_rows: unclassified,
      unclassified_share: unclassified / rows.length,
    },
    diagnostics: [],
  };
}

/**
 * An engine that answers each upload with the next of `results`, and counts its calls.
 *
 * @param {object[]} results Pipeline results, one per upload, in order.
 * @returns {object} The engine, with `calls.runs`.
 */
export function scenarioEngine(results) {
  const calls = { runs: 0 };
  return {
    calls,
    async run() {
      const result = results[calls.runs % results.length];
      calls.runs += 1;
      const plan = { actions: [], counts: { new: result.transactions.length, matched: 0, collided: 0 } };
      return { ok: true, pipeline_result_json: JSON.stringify(result), plan_json: JSON.stringify(plan) };
    },
    async warm_up() {},
    cancel() {},
  };
}
