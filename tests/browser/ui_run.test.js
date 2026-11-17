// tools/equivalence/ui_run.mjs on synthetic fixtures (CP8b item 9): it drives the real UI, prints
// counts only, writes nothing, takes a password only from its hidden prompt, and reports the
// transactions the Ledger shows, compareWithApi and CSP violations.
// Needs the runtime and the app built (npm run build in web/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { manifest_password } from "../../tools/pdf_readers/fixture_reader.js";

const REPO = join(import.meta.dirname, "../..");
const TOOL = join(REPO, "tools/equivalence/ui_run.mjs");
const FIXTURES = join(REPO, "tests/fixtures/synthetic");
const COUNT_LINE = /^[a-z_]+: [0-9a-z_()A-Z]+$/;
const scratch = mkdtempSync(join(tmpdir(), "ui-run-"));

after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Run the tool from an empty folder, so anything it wrote there would show.
 *
 * @param {string[]} args Its arguments.
 * @param {string} [input] What stdin carries, for the password prompt.
 * @returns {{status: number, stdout: string}} The process outcome.
 */
function ui_run(args, input = "") {
  return spawnSync(process.execPath, [TOOL, ...args], {
    cwd: scratch,
    input,
    encoding: "utf8",
    timeout: 600_000,
  });
}

/**
 * The tool's printed counts.
 *
 * @param {string} stdout Its output.
 * @returns {Record<string, string>} By name.
 */
function counts_of(stdout) {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(": ")),
  );
}

test("a statement read through the UI prints its counts only and writes nothing", () => {
  const expected = JSON.parse(readFileSync(join(FIXTURES, "F-GOLDEN.expected.json"), "utf8"));
  const completed = ui_run(["--pdf", join(FIXTURES, "F-GOLDEN.pdf")]);
  assert.equal(completed.status, 0, completed.stdout);
  for (const line of completed.stdout.trim().split("\n")) assert.match(line, COUNT_LINE);
  const counts = counts_of(completed.stdout);
  assert.equal(counts.ui_run, "PASS");
  assert.equal(Number(counts.transactions_shown), expected.row_count);
  assert.equal(counts.compare_with_api, "pass");
  assert.equal(counts.csp_violations, "0");
  assert.equal(counts.csp_console_reports, "0");
  assert.equal(counts.requests_other_origin, "0");
  assert.equal(counts.requests_breaking_rule, "0");
  assert.equal(completed.stdout.includes(expected.verification_token), false);
  assert.deepEqual(readdirSync(scratch), []);
});

test("a password statement asks for its password at the prompt, and it is never printed", () => {
  const password = manifest_password();
  const completed = ui_run(["--pdf", join(FIXTURES, "F-ENCRYPTED.pdf")], `${password}\n`);
  assert.equal(completed.status, 0, completed.stdout);
  assert.equal(counts_of(completed.stdout).ui_run, "PASS");
  assert.equal(completed.stdout.includes(password), false);
});

test("a statement the UI refuses prints only its code", () => {
  const completed = ui_run(["--pdf", join(FIXTURES, "F-NOTABLE.pdf")]);
  assert.equal(completed.status, 2);
  assert.equal(completed.stdout, "ui_run: ERROR (LAYOUT_UNRECOGNIZED)\n");
});

test("any other option is refused, so a password cannot be passed on the command line", () => {
  const completed = ui_run(["--pdf", "statement.pdf", "--password", "not-a-real-one"]);
  assert.equal(completed.status, 2);
  assert.equal(completed.stdout.includes("not-a-real-one"), false);
});
