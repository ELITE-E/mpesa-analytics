// CP8b item 5: the copy says what the app really does. The statement stays in this browser, there
// is no account and no server, and a statement is never called verified or genuine: it passes
// consistency checks, and Safaricom is the one who can verify it. The E2E side is in
// tests/e2e-local.test.mjs.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/honest-copy.test.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { coreFixtures } from "./support/core-fixtures.mjs";

globalThis.window = { location: new URL("https://app.test/") };

const SRC = join(import.meta.dirname, "../src");
const { StatementChecksCard } = await import("../src/components/analysis-summary/statement-checks-card.tsx");
const analysisSummaryCopy = await import("../src/content/analysis-summary.ts");
const { checks: checksCopy } = analysisSummaryCopy;
const repo = await import("../src/data/repo.ts");

/**
 * Every source file under a directory.
 *
 * @param {string} directory Where to start.
 * @returns {string[]} The files' paths.
 */
function source_files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? source_files(join(directory, entry.name))
      : /\.(ts|tsx)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}

/**
 * The visible text of rendered HTML.
 *
 * @param {string} html The HTML.
 * @returns {string} Its text, whitespace collapsed.
 */
function text_of(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

const INSTRUCTION = "To verify this statement, dial *123# and enter the code";
const FALLBACK = "Use the verification instruction printed on your statement.";

const CHECKS = {
  verification_token: "QX7" + "M2KP9",
  verification_instruction: INSTRUCTION,
  row_count: 40,
  chain_breaks: 0,
  totals_match: "yes",
  unclassified_rows: 3,
  unclassified_share: 0.075,
};

test("no copy claims an account, a server or a saved import", () => {
  for (const file of source_files(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const claim of [/Private to Your Account/i, /Saved to Your Account/i, /our server/i, /saved to your account/i]) {
      assert.equal(claim.test(source), false, `${file}: ${claim}`);
    }
  }
});

test("the welcome, upload and header copy say the statement stays on this device", async () => {
  const welcome = await import("../src/content/welcome.ts");
  const upload = await import("../src/content/upload.ts");
  assert.equal(welcome.hero.privacyLabel, "Private on this device");
  assert.equal(upload.pipeline.badge, "Private on this device");
  const { AppHeader } = await import("../src/components/app-header.tsx");
  assert.match(text_of(renderToString(createElement(AppHeader))), /Private on this device/);
});

test("a statement that passes the checks shows its code, how to verify it, and the honest wording", () => {
  const text = text_of(renderToString(createElement(StatementChecksCard, { checks: CHECKS })));
  assert.match(text, new RegExp(CHECKS.verification_token));
  assert.ok(text.includes(INSTRUCTION), "the instruction as the statement prints it");
  assert.match(text, /passes consistency checks, not yet verified with Safaricom/);
  assert.equal(/genuine|authentic/i.test(text), false);
  assert.equal(text.replace("not yet verified with Safaricom", "").includes("verified"), false);
});

test("a statement whose instruction cannot be read shows the fallback sentence, never a guessed code", () => {
  const text = text_of(
    renderToString(createElement(StatementChecksCard, { checks: { ...CHECKS, verification_instruction: null } })),
  );
  assert.ok(text.includes(FALLBACK));
  assert.equal(/\*\d+#/.test(text), false, "no dial code the app assumes");
});

test("the app keeps no verification code of its own", () => {
  assert.equal("SAFARICOM_VERIFY_CODE" in analysisSummaryCopy, false);
  assert.equal(JSON.stringify(checksCopy).match(/\*\d+#/), null);
  const card = readFileSync(join(SRC, "components/analysis-summary/statement-checks-card.tsx"), "utf8");
  assert.equal(/\*\d+#/.test(card), false);
});

test("rows that do not chain, the totals check and the uncategorised share are shown", () => {
  const text = text_of(
    renderToString(
      createElement(StatementChecksCard, { checks: { ...CHECKS, chain_breaks: 2, totals_match: "no" } }),
    ),
  );
  assert.match(text, /2 rows do not chain/);
  assert.match(text, new RegExp(checksCopy.totals.no));
  assert.match(text, /Uncategorised: 3 rows \(7\.5%\)/);
  assert.equal(text.includes("passes consistency checks"), false);
  assert.match(text, /not yet verified with Safaricom/);
});

test("a missing summary block is said plainly, never guessed", () => {
  const text = text_of(
    renderToString(createElement(StatementChecksCard, { checks: { ...CHECKS, totals_match: "not_found" } })),
  );
  assert.match(text, new RegExp(checksCopy.totals.not_found));
});

test("the data layer gives each statement's checks from the core's data quality", async () => {
  const { "F-CHAIN-BREAK": chained } = coreFixtures(["F-CHAIN-BREAK"]);
  repo.useEngineForTests({
    async run() {
      return {
        ok: true,
        pipeline_result_json: JSON.stringify(chained.pipeline_result),
        plan_json: JSON.stringify(chained.plan),
      };
    },
  });
  const created = await repo.uploadStatement(new File([new Uint8Array([0x25])], "s.pdf"), "");
  const checks = await repo.getStatementChecks(created.import.id);
  const quality = chained.pipeline_result.quality;
  assert.deepEqual(checks, {
    verification_token: chained.pipeline_result.verification_token,
    verification_instruction: chained.pipeline_result.verification_instruction,
    row_count: quality.row_count,
    chain_breaks: quality.chain_breaks,
    totals_match:
      quality.summary_total_paid_in_matches === null || quality.summary_total_paid_out_matches === null
        ? "not_found"
        : quality.summary_total_paid_in_matches && quality.summary_total_paid_out_matches
          ? "yes"
          : "no",
    unclassified_rows: quality.unclassified_rows,
    unclassified_share: quality.unclassified_share,
  });
  assert.ok(checks.chain_breaks > 0);
});
