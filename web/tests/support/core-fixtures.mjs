// Core output for the frontend's tests, from the repo's synthetic fixtures (tools/synth), run
// through the real core under CPython: pipeline.run, then the import plan against what the
// session already holds. Replaces the prototype's contract and sample fixtures while their status
// is UNCONFIRMED (CP8b item 0). Synthetic data only.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PYTHON = join(REPO, ".venv", "bin", "python");
export const PROCESSED_AT = "2026-11-16T09:00:00Z";

const SCRIPT = `
import json, sys
from pathlib import Path
from mpesa_core import bridge, pipeline
names = json.loads(sys.argv[1])
fixtures = Path(sys.argv[2])
out = {}
for name in names:
    pages = json.loads((fixtures / f"{name}.items.json").read_text())
    result = json.loads(json.dumps(pipeline.run(pages, processed_at=sys.argv[3])))
    plan = json.loads(bridge.plan_statement_import_json(json.dumps(
        {"incoming_rows": result["transactions"], "existing_transactions": []})))
    out[name] = {"pipeline_result": result, "plan": plan}
print(json.dumps(out))
`;

/**
 * The core's pipeline result and import plan (against an empty session) for synthetic fixtures.
 *
 * @param {string[]} names Fixture names, e.g. "F-GOLDEN".
 * @returns {Record<string, {pipeline_result: object, plan: object}>} By fixture name.
 * @throws {Error} If Python fails.
 */
export function coreFixtures(names) {
  const ran = spawnSync(
    PYTHON,
    ["-c", SCRIPT, JSON.stringify(names), join(REPO, "tests/fixtures/synthetic"), PROCESSED_AT],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: REPO },
  );
  if (ran.status !== 0) throw new Error(`core fixtures failed: ${ran.stderr.split("\n").at(-2)}`);
  return JSON.parse(ran.stdout);
}

/** Every committed fixture that has rows and opens without a password. */
export const FIXTURES_WITH_ROWS = [
  "F-GOLDEN",
  "F-TIES",
  "F-SPLIT",
  "F-DENSE",
  "F-BASIC",
  "F-MULTILINE",
  "F-MULTIPAGE",
  "F-JITTER",
  "F-CONT-ABOVE",
  "F-SUMMARY-MISMATCH",
  "F-CHAIN-BREAK",
];
