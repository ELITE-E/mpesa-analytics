// CP9c item 2: the unlock screen, the Lock button, the auto-lock notice and the "forgot it?" path
// (N-01, N-06, N-11, N-16, N-22). The controller runs over fake IndexedDB with a manual clock and
// the real core under CPython; the screens are rendered as the static export renders them.
// Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/remember-unlock.test.mjs

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { startCpythonCore } from "./support/cpython-core.mjs";
import { IMPORTED_AT, pipelineResult, rows } from "./support/store-fixtures.mjs";
import { OTHER_PASSPHRASE, PASSPHRASE, TEST_ITERATIONS, databaseNames, vaultEnvironment } from "./support/vault-environment.mjs";

const remember = await import("../src/lib/remember.ts");
const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { storeCoreFrom } = await import("../src/persistence/store-core.ts");
const { unlock: copy, deleteAll } = await import("../src/content/remember.ts");
const { UnlockForm } = await import("../src/components/remember/unlock-form.tsx");
const { DeleteAllControl } = await import("../src/components/remember/delete-all.tsx");
const { LockControl } = await import("../src/components/remember/lock-control.tsx");
const repo = await import("../src/data/repo.ts");

const TEN_MINUTES = 10 * 60 * 1000;
const HINT = "the trip to the coast";

let core;
before(() => {
  core = startCpythonCore();
});
after(() => core.close());
afterEach(() => remember.resetRememberForTests());

/** Start the controller on a device (fresh unless given), as a page load does. */
async function load(environment = vaultEnvironment()) {
  remember.resetRememberForTests();
  await remember.startRemember({
    openVault: () => openVaultWithIterations(TEST_ITERATIONS, environment),
    core: storeCoreFrom(core.call),
  });
  return environment;
}

/** A device where remembering is on, with one statement saved, then reloaded (locked). */
async function savedThenReloaded({ hint = HINT } = {}) {
  const environment = await load();
  await remember.turnOnRemember({ passphrase: PASSPHRASE, confirmation: PASSPHRASE, hint });
  await remember.rememberedStoreForTests().rememberStatement({ pipelineResult: pipelineResult(rows(1, 3)), importedAt: IMPORTED_AT });
  await load(environment);
  return environment;
}

/** The visible text of rendered HTML. */
function textOf(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

test("after a reload, saved data is locked and the data layer shows none of it", async () => {
  await savedThenReloaded();
  assert.equal(remember.rememberView().phase, "locked");
  assert.deepEqual(await repo.listImports(), { items: [] });
});

test("a wrong passphrase fails closed and only then shows the hint (N-01, N-11)", async () => {
  await savedThenReloaded();
  assert.equal(remember.rememberView().hint, null);
  await assert.rejects(() => remember.unlockRemember(OTHER_PASSPHRASE), (error) => error.code === "WRONG_PASSPHRASE");
  assert.equal(remember.rememberView().phase, "locked");
  assert.equal(remember.rememberView().hint, HINT);
  assert.deepEqual(await repo.listImports(), { items: [] });
});

test("with no hint set, none is shown after a wrong passphrase", async () => {
  await savedThenReloaded({ hint: "" });
  await assert.rejects(() => remember.unlockRemember(OTHER_PASSPHRASE));
  assert.equal(remember.rememberView().hint, null);
});

test("unlocking opens the saved ledger: the data is back, and the hint is hidden again", async () => {
  await savedThenReloaded();
  await assert.rejects(() => remember.unlockRemember(OTHER_PASSPHRASE));
  await remember.unlockRemember(PASSPHRASE);
  const view = remember.rememberView();
  assert.equal(view.phase, "unlocked");
  assert.equal(view.hint, null);
  assert.equal((await repo.listImports()).items.length, 1);
  assert.equal((await repo.listImports()).items[0].transaction_count, 3);
});

test("Lock drops the data from the screen and says it was locked by hand", async () => {
  await savedThenReloaded();
  await remember.unlockRemember(PASSPHRASE);
  remember.lockRemember();
  assert.equal(remember.rememberView().phase, "locked");
  assert.equal(remember.rememberView().lockReason, "manual");
  assert.deepEqual(await repo.listImports(), { items: [] });
});

test("after ten idle minutes it locks itself and says why; activity restarts the time (N-06)", async () => {
  const environment = await savedThenReloaded();
  await remember.unlockRemember(PASSPHRASE);
  environment.timers.advance(TEN_MINUTES - 1000);
  remember.noteRememberActivity();
  environment.timers.advance(TEN_MINUTES - 1000);
  assert.equal(remember.rememberView().phase, "unlocked");
  environment.timers.advance(1000);
  assert.equal(remember.rememberView().phase, "locked");
  assert.equal(remember.rememberView().lockReason, "idle");
  assert.deepEqual(await repo.listImports(), { items: [] });
});

test("forgot it? delete-all works while locked and leaves storage empty (N-16)", async () => {
  const environment = await savedThenReloaded();
  await remember.deleteEverything();
  assert.equal(remember.rememberView().phase, "off");
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("the unlock screen asks for the passphrase and offers the forgot path, with no hint before a failure", () => {
  const html = renderToString(createElement(UnlockForm, { view: { phase: "locked", hint: null, lockReason: null } }));
  const text = textOf(html);
  assert.ok(text.includes(copy.title));
  assert.equal(html.match(/type="password"/g).length, 1);
  assert.ok(text.includes(copy.submitLabel));
  assert.ok(text.includes(copy.forgotTitle));
  assert.ok(text.includes(copy.forgotBody));
  assert.ok(text.includes(copy.forgotAction));
  assert.equal(text.includes(copy.hintLabel), false);
});

test("after a failed attempt the unlock screen shows the hint", () => {
  const text = textOf(renderToString(createElement(UnlockForm, { view: { phase: "locked", hint: HINT, lockReason: null } })));
  assert.ok(text.includes(copy.hintLabel));
  assert.ok(text.includes(HINT));
});

test("the unlock screen says when it locked itself after the idle time", () => {
  const idle = textOf(renderToString(createElement(UnlockForm, { view: { phase: "locked", hint: null, lockReason: "idle" } })));
  assert.ok(idle.includes(copy.idleNotice));
  const manual = textOf(renderToString(createElement(UnlockForm, { view: { phase: "locked", hint: null, lockReason: "manual" } })));
  assert.ok(manual.includes(copy.lockedNotice));
  assert.equal(manual.includes(copy.idleNotice), false);
});

test("delete-all asks for confirmation before it deletes anything", () => {
  const text = textOf(renderToString(createElement(DeleteAllControl, { label: copy.forgotAction })));
  assert.ok(text.includes(copy.forgotAction));
  assert.equal(text.includes(deleteAll.confirmAction), false);
});

test("the header shows Lock while unlocked, an Unlock link while locked, and nothing while off", () => {
  assert.ok(textOf(renderToString(createElement(LockControl, { view: { phase: "unlocked" } }))).includes(copy.lockLabel));
  const locked = renderToString(createElement(LockControl, { view: { phase: "locked" } }));
  assert.ok(textOf(locked).includes(copy.unlockChip));
  assert.match(locked, /href="\/unlock"/);
  assert.equal(textOf(renderToString(createElement(LockControl, { view: { phase: "off" } }))), "");
});
