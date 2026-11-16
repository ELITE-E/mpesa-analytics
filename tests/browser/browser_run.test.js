// tools/equivalence/browser_run.mjs on synthetic fixtures: counts only, owner-only output outside
// the repo, no account digest written, and compare.py --browser-result passes on what it writes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  extract_fixture,
  manifest_password,
  use_node_reader,
} from "../../tools/pdf_readers/fixture_reader.js";

const REPO = join(import.meta.dirname, "../..");
const TOOL = join(REPO, "tools/equivalence/browser_run.mjs");
const FIXTURES = join(REPO, "tests/fixtures/synthetic");
const scratch = mkdtempSync(join(tmpdir(), "browser-run-"));
const COUNT_LINE = /^[a-z_]+: [0-9a-z_.()A-Z-]+$/;
const SEVEN_FIELDS = [
  "receipt_no",
  "completion_time",
  "details",
  "status",
  "paid_in",
  "withdrawn",
  "balance",
];

after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Run the tool.
 *
 * @param {string[]} args Its arguments.
 * @param {string} [input] What stdin carries, for the password prompt.
 * @returns {{status: number, stdout: string, stderr: string}} The process outcome.
 */
function browser_run(args, input = "") {
  return spawnSync(process.execPath, [TOOL, ...args], {
    input,
    encoding: "utf8",
    timeout: 600_000,
  });
}

/**
 * Write a baseline as export_baseline.py would, from the fixture's ledger, via the test helper.
 *
 * @param {string} name Fixture name.
 * @param {string} directory Where to write.
 * @returns {string} The baseline's path.
 */
function write_synthetic_baseline(name, directory) {
  const script = [
    "import json, sys, pathlib",
    "from test_compare import write_baseline, baseline_from",
    `print(write_baseline(pathlib.Path(sys.argv[1]), baseline_from(${JSON.stringify(name)})))`,
  ].join("\n");
  const python = join(REPO, ".venv/bin/python");
  // The same import paths pytest uses (pyproject.toml), so test_compare imports as under pytest.
  const pythonPath = ["tests/guards", "tools/guards", "tools", "tests/equivalence"].join(":");
  const ran = spawnSync(python, ["-c", script, directory], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: pythonPath },
  });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

test("a synthetic statement runs in Chrome and prints counts only", async () => {
  const out = join(scratch, "golden");
  const outcome = browser_run(["--pdf", join(FIXTURES, "F-GOLDEN.pdf"), "--out", out]);
  assert.equal(outcome.status, 0, outcome.stdout);
  for (const line of outcome.stdout.trim().split("\n")) assert.match(line, COUNT_LINE);
  assert.match(outcome.stdout, /^browser_run: PASS$/m);
  assert.match(outcome.stdout, /^pages: 2$/m);
  assert.match(outcome.stdout, /^other_requests: 0$/m);
  assert.equal(outcome.stdout.includes(scratch), false);
  assert.equal(statSync(out).mode & 0o777, 0o700);
  for (const name of ["pages.json", "result.json"]) {
    assert.equal(statSync(join(out, name)).mode & 0o777, 0o600, name);
  }
  await use_node_reader();
  const pages = JSON.parse(readFileSync(join(out, "pages.json"), "utf8"));
  assert.deepEqual(pages, await extract_fixture("F-GOLDEN"));
  const written = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
  assert.deepEqual(Object.keys(written).sort(), [
    "account_digest_present",
    "pipeline_result",
    "processed_at",
  ]);
  assert.equal("account_digest" in written.pipeline_result, false);
  assert.equal(written.account_digest_present, true);
});

test("compare.py --browser-result passes on what browser_run wrote", () => {
  const out = join(scratch, "golden");
  const baseline = write_synthetic_baseline("F-GOLDEN", mkdtempSync(join(scratch, "base-")));
  const python = join(REPO, ".venv/bin/python");
  const compare = spawnSync(
    python,
    [
      join(REPO, "tools/equivalence/compare.py"),
      "--browser-result",
      out,
      "--baseline",
      baseline,
      "--share",
    ],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(compare.status, 0, compare.stdout + compare.stderr);
  assert.match(compare.stdout, /^PASS browser_result_equals_cpython$/m);
  assert.match(compare.stdout, /^RESULT: PASS$/m);
  assert.ok(SEVEN_FIELDS.every((field) => compare.stdout.includes(`mismatch_${field}: 0`)));
});

test("a password PDF asks for its password on stdin and never prints it", () => {
  const password = manifest_password();
  const out = join(scratch, "encrypted");
  const outcome = browser_run(
    ["--pdf", join(FIXTURES, "F-ENCRYPTED.pdf"), "--out", out],
    `${password}\n`,
  );
  assert.equal(outcome.status, 0, outcome.stdout);
  assert.equal(outcome.stdout.includes(password), false);
  assert.equal(outcome.stderr.includes(password), false);
  assert.equal(readFileSync(join(out, "result.json"), "utf8").includes(password), false);
});

test("a wrong password prints a code only and writes nothing", () => {
  const out = join(scratch, "wrong");
  const outcome = browser_run(["--pdf", join(FIXTURES, "F-ENCRYPTED.pdf"), "--out", out], "no\n");
  assert.equal(outcome.status, 2);
  assert.equal(outcome.stdout, "browser_run: ERROR (PASSWORD_INCORRECT)\n");
});

test("an output folder inside the repo is refused before anything is read", () => {
  const outcome = browser_run([
    "--pdf",
    join(FIXTURES, "F-GOLDEN.pdf"),
    "--out",
    join(REPO, ".cache", "x"),
  ]);
  assert.equal(outcome.status, 2);
  assert.equal(outcome.stdout, "browser_run: ERROR (--out must be outside the repo)\n");
});

test("an existing output folder is refused, so nothing is overwritten", () => {
  const out = mkdtempSync(join(scratch, "exists-"));
  writeFileSync(join(out, "keep.txt"), "keep");
  const outcome = browser_run(["--pdf", join(FIXTURES, "F-GOLDEN.pdf"), "--out", out]);
  assert.equal(outcome.status, 2);
  assert.equal(
    outcome.stdout,
    "browser_run: ERROR (--out exists: remove the old --out folder first)\n",
  );
});

test("any other argument, a password flag included, is refused", () => {
  const outcome = browser_run(["--pdf", "x.pdf", "--out", join(scratch, "o"), "--password", "p"]);
  assert.equal(outcome.status, 2);
  assert.equal(
    outcome.stdout,
    "browser_run: ERROR (expected --pdf <pdf> --out <dir> and nothing else)\n",
  );
});
