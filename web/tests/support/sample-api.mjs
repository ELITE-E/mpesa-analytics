// The prototype's sample (F5) and the five edge-case statements, served the way the old API served
// them, for screens that need a loaded import. Each comes from its ledger JSON, written by the
// generator (CP8b decision A), with the core's own report on its rows as the analytics, recorded by
// tools/record_scenario_reports.py. Synthetic data only; no Python runs at test time.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES, scenarioLedger } from "./contract-fixtures.mjs";
import { json } from "./fake-api.mjs";

/** The import id every payload here uses. */
export const SAMPLE_IMPORT_ID = 1;

/**
 * A scenario as import SAMPLE_IMPORT_ID.
 *
 * @param {string} name The scenario's name.
 * @returns {{rows: object[], summary: object, snapshot: object}} Its ledger, renumbered.
 */
function asSampleImport(name) {
  const fixture = scenarioLedger(name);
  return {
    ...fixture,
    summary: { ...fixture.summary, id: SAMPLE_IMPORT_ID },
    snapshot: { ...fixture.snapshot, import_id: SAMPLE_IMPORT_ID },
  };
}

/**
 * A scenario with the core's report on its rows as the analytics.
 *
 * @param {string} name The scenario's name.
 * @returns {{rows: object[], summary: object, snapshot: object}} Its ledger and report.
 */
function withCoreReport(name) {
  const fixture = asSampleImport(name);
  const { report } = JSON.parse(readFileSync(join(FIXTURES, `${name}.report.json`), "utf8"));
  return { ...fixture, snapshot: { ...fixture.snapshot, result: report } };
}

/**
 * Fixture F5, the prototype's sample, with the totals-only analytics its ledger holds.
 *
 * @returns {{rows: object[], summary: object, snapshot: object}} The fixture.
 */
export function prototypeSampleFixture() {
  return asSampleImport("F5-prototype-converted");
}

/**
 * Fixture F5 with the core's report as its analytics, so screens that link from analytics lists
 * render real links. Same rows and summary as prototypeSampleFixture.
 *
 * @returns {{rows: object[], summary: object, snapshot: object}} The fixture.
 */
export function prototypeSampleWithBackendAnalytics() {
  return withCoreReport("F5-prototype-converted");
}

/** @returns {object} The Overview stress statement: long names, no inflow, negative net flow. */
export function stressOverviewFixture() {
  return withCoreReport("S-stress-overview");
}

/** @returns {object} A statement without spending: transfers, airtime, cash and their charges. */
export function noSpendingFixture() {
  return withCoreReport("S-no-spending");
}

/** @returns {object} People edge cases: two spellings, a long name, no recipient, a namesake. */
export function peopleEdgeCasesFixture() {
  return withCoreReport("S-people-edge-cases");
}

/** @returns {object} Savings edge cases: two platforms, a long name, an unknown one, two months. */
export function savingsEdgeCasesFixture() {
  return withCoreReport("S-savings-edge-cases");
}

/** @returns {object} Cash edge cases: two agents, a long name, an unknown one, a deposit. */
export function cashEdgeCasesFixture() {
  return withCoreReport("S-cash-edge-cases");
}

/**
 * A fake-API answer for the app's reads about `fixture`: the import list, the import, its
 * analytics and its transaction pages (by `limit` and `offset`, with the full `total`). Anything
 * else is a 404 in the API's error format, or `fallback`'s answer when one is given.
 *
 * @param {object} fixture A fixture from this module.
 * @param {Function|null} [fallback] Answers any other request.
 * @returns {Function} The fake API's `respond` callback.
 */
export function sampleReadResponder(fixture, fallback = null) {
  const base = `/api/v1/imports/${SAMPLE_IMPORT_ID}`;
  return (request) => {
    const { method, path, query } = request;
    if (method === "GET" && path === "/api/v1/imports") return json(200, { items: [fixture.summary] });
    if (method === "GET" && path === base) return json(200, fixture.summary);
    if (method === "GET" && path === `${base}/analytics`) return json(200, fixture.snapshot);
    if (method === "GET" && path === `${base}/transactions`) {
      const limit = Number(query.get("limit"));
      const offset = Number(query.get("offset"));
      const items = fixture.rows.slice(offset, offset + limit);
      return json(200, { items, total: fixture.rows.length, limit, offset });
    }
    return fallback?.(request) ?? json(404, { error: { code: "not_found", message: "Not found." } });
  };
}
