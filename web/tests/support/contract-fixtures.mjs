// The frontend's contract scenarios F1 to F5, as the generator wrote them (tools/synth/scenarios.py,
// CP8b decision A): each one's rows, summary and snapshot, read from its ledger JSON. Synthetic
// data only; no Python runs at test time. F1 a worked example (linked, orphan and ambiguous fees,
// reversals both ways, an unexpected direction), F2 tied times, F3 unreadable times, F4 2,345
// rows, F5 the IA prototype's sample.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/synthetic");
const CONTRACT = [
  "F1-worked-example",
  "F2-tied-timestamps",
  "F3-invalid-timestamps",
  "F4-paginated-2345",
  "F5-prototype-converted",
];

/**
 * One scenario's ledger, freshly parsed, so a test may change it.
 *
 * @param {string} name The scenario's name.
 * @returns {{rows: object[], summary: object, snapshot: object}} Its ledger.
 */
export function scenarioLedger(name) {
  const { rows, summary, snapshot } = JSON.parse(readFileSync(join(FIXTURES, `${name}.api.json`), "utf8"));
  return { rows, summary, snapshot };
}

/**
 * Every contract scenario by name ("F1-worked-example", …), each with the import id its position
 * gives it (from 1).
 *
 * @returns {Record<string, {rows: object[], summary: object, snapshot: object}>} By name.
 */
export function contractFixtures() {
  return Object.fromEntries(CONTRACT.map((name) => [name, scenarioLedger(name)]));
}
