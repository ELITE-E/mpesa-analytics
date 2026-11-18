// CP9c item 5: the statement list with remove (and its confirmation), the saved quality card
// after a reload, and delete-all in settings (N-15, N-16, N-31). The controller runs over fake
// IndexedDB with the real core under CPython; the screens are rendered as the static export
// renders them. Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/remember-settings.test.mjs

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { startCpythonCore } from "./support/cpython-core.mjs";
import { IMPORTED_AT, pipelineResult, row, rows } from "./support/store-fixtures.mjs";
import { PASSPHRASE, TEST_ITERATIONS, vaultEnvironment } from "./support/vault-environment.mjs";

const remember = await import("../src/lib/remember.ts");
const repo = await import("../src/data/repo.ts");
const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { storeCoreFrom } = await import("../src/persistence/store-core.ts");
const { settings, deleteAll, rememberCard, unlock } = await import("../src/content/remember.ts");
const { checks: checksCopy } = await import("../src/content/analysis-summary.ts");
const { StatementList } = await import("../src/components/remember/statement-list.tsx");
const { SettingsSections } = await import("../src/components/remember/settings-panel.tsx");
const { StatementChecksCard } = await import("../src/components/analysis-summary/statement-checks-card.tsx");

let core;
before(() => {
  core = startCpythonCore();
});
after(() => core.close());
afterEach(() => remember.resetRememberForTests());

/** Load the app's controller on a device (fresh unless given). */
async function load(environment = vaultEnvironment()) {
  remember.resetRememberForTests();
  await remember.startRemember({ openVault: () => openVaultWithIterations(TEST_ITERATIONS, environment), core: storeCoreFrom(core.call) });
  return environment;
}

/** Remember each result in turn on a fresh device, unlocked. */
async function remembered(results) {
  const environment = await load();
  await remember.turnOnRemember({ passphrase: PASSPHRASE, confirmation: PASSPHRASE, hint: "" });
  for (const result of results) {
    await remember.rememberedStoreForTests().rememberStatement({ pipelineResult: result, importedAt: IMPORTED_AT });
  }
  return environment;
}

/** The visible text of rendered HTML. */
function textOf(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

test("removing a statement takes it and the rows only it printed out of the ledger", async () => {
  await remembered([pipelineResult(rows(1, 3)), pipelineResult(rows(3, 5))]);
  const [newest, oldest] = (await repo.listImports()).items;
  await remember.removeStatement(oldest.id);
  assert.deepEqual((await repo.listImports()).items.map((item) => item.id), [newest.id]);
  assert.equal((await repo.getAllTransactions(newest.id)).length, 3);
  assert.equal(remember.rememberedStoreForTests().currentLedger().transactions.length, 3);
});

test("the saved quality card is there after a reload: rows that do not chain and the totals check (N-31)", async () => {
  const environment = await remembered([pipelineResult(rows(1, 4), { chainBreaks: 2, totalsMatch: false })]);
  await load(environment);
  await remember.unlockRemember(PASSPHRASE);
  const [statement] = (await repo.listImports()).items;
  const checks = await repo.getStatementChecks(statement.id);
  assert.equal(checks.chain_breaks, 2);
  assert.equal(checks.totals_match, "no");
  assert.equal(checks.verification_token, "");
  const text = textOf(renderToString(createElement(StatementChecksCard, { checks })));
  assert.ok(text.includes(checksCopy.chainBreaks(2)));
  assert.ok(text.includes(checksCopy.totals.no));
  assert.ok(text.includes(checksCopy.tokenNotKept), "a remembered statement says its code is not kept");
});

test("the statement list shows each saved statement with Remove, and no confirmation until asked", () => {
  const statements = [
    { id: 4, imported_at: "2026-11-18T09:00:00Z", period_start: "2026-01-02 10:00:00", period_end: "2026-01-09 10:00:00", status: "completed", transaction_count: 7, previously_imported_transaction_count: 0, unclassified_transaction_count: 0, observation_counts: {} },
  ];
  const text = textOf(renderToString(createElement(StatementList, { statements, onRemove() {} })));
  assert.ok(text.includes(settings.statementsTitle));
  assert.ok(text.includes(settings.removeLabel));
  assert.ok(text.includes("7 transactions"));
  assert.equal(text.includes(settings.removeConfirm), false);
  assert.equal(text.includes(settings.removeQuestion), false);
});

test("an empty ledger says so", () => {
  const text = textOf(renderToString(createElement(StatementList, { statements: [], onRemove() {} })));
  assert.ok(text.includes(settings.noStatements));
});

test("settings while unlocked: the card, the ledgers, the statements and delete-all", () => {
  const html = renderToString(
    createElement(SettingsSections, {
      view: { phase: "unlocked", storageMessage: null, hint: null, lockReason: null, notice: null },
      ledgers: [{ ledgerId: "a".repeat(64), statementCount: 1, period: { start: "2026-01-02 10:00:00", end: "2026-01-09 10:00:00" } }],
      currentLedgerId: "a".repeat(64),
      statements: [],
      onSwitch() {},
      onRemove() {},
    }),
  );
  const text = textOf(html);
  for (const expected of [settings.title, rememberCard.title, settings.ledgersTitle, settings.statementsTitle, deleteAll.title, deleteAll.action]) {
    assert.ok(text.includes(expected), expected);
  }
});

test("settings while locked: an unlock link and delete-all, but no saved statements", () => {
  const html = renderToString(
    createElement(SettingsSections, {
      view: { phase: "locked", storageMessage: null, hint: null, lockReason: null, notice: null },
      ledgers: [],
      currentLedgerId: null,
      statements: [],
      onSwitch() {},
      onRemove() {},
    }),
  );
  const text = textOf(html);
  assert.ok(text.includes(deleteAll.action));
  assert.match(html, /href="\/unlock"/);
  assert.ok(text.includes(unlock.unlockChip));
  assert.equal(text.includes(settings.statementsTitle), false);
});

test("settings while off: the card only; there is nothing to delete", () => {
  const text = textOf(
    renderToString(
      createElement(SettingsSections, {
        view: { phase: "off", storageMessage: null, hint: null, lockReason: null, notice: null },
        ledgers: [],
        currentLedgerId: null,
        statements: [],
        onSwitch() {},
        onRemove() {},
      }),
    ),
  );
  assert.ok(text.includes(rememberCard.title));
  assert.equal(text.includes(deleteAll.action), false);
});

test("a statement shared by two ledgers' worth of rows keeps the other statement's rows", async () => {
  await remembered([pipelineResult([row(1), row(2)]), pipelineResult([row(2), row(3)])]);
  const [newest] = (await repo.listImports()).items;
  await remember.removeStatement(newest.id);
  assert.equal(remember.rememberedStoreForTests().currentLedger().transactions.length, 2);
});

test("after delete-all, settings says everything was deleted", async () => {
  await remembered([]);
  await remember.deleteEverything();
  const view = remember.rememberView();
  assert.equal(view.notice, "deleted");
  const text = textOf(
    renderToString(
      createElement(SettingsSections, { view, ledgers: [], currentLedgerId: null, statements: [], onSwitch() {}, onRemove() {} }),
    ),
  );
  assert.ok(text.includes(deleteAll.done));
});
