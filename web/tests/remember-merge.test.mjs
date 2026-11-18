// CP9c items 3 and 4: the merge screen and the ledger switcher (N-19, N-20, N-21, N-22, N-24 to
// N-27). The data layer reads a statement and, with remember on, proposes the merge: counts before
// any write, confirm or cancel, a different account as a separate ledger (never a replace), and a
// statement with no readable account added only to a ledger the person picks. Real core under
// CPython, fake IndexedDB, invented values.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/remember-merge.test.mjs

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { IDBObjectStore } from "fake-indexeddb";

import { startCpythonCore } from "./support/cpython-core.mjs";
import { OTHER_DIGEST, pipelineResult, row, rows } from "./support/store-fixtures.mjs";
import { PASSPHRASE, TEST_ITERATIONS, dumpDatabases, vaultEnvironment } from "./support/vault-environment.mjs";

const remember = await import("../src/lib/remember.ts");
const repo = await import("../src/data/repo.ts");
const flow = await import("../src/lib/upload-flow.ts");
const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { storeCoreFrom } = await import("../src/persistence/store-core.ts");
const { merge: copy, settings } = await import("../src/content/remember.ts");
const { MergeReview, MergeSaved } = await import("../src/components/remember/merge-review.tsx");
const { LedgerSwitcher } = await import("../src/components/remember/ledger-switcher.tsx");

const originalPut = IDBObjectStore.prototype.put;
let core;
before(() => {
  core = startCpythonCore();
});
after(() => core.close());
afterEach(() => {
  IDBObjectStore.prototype.put = originalPut;
  remember.resetRememberForTests();
  flow.resetUploadFlowForTests();
});

/** An engine that answers each read with the next pipeline result. */
function engineFor(results) {
  let reads = 0;
  return {
    async run() {
      const result = results[reads++];
      const plan = { actions: [], counts: { new: result.transactions.length, matched: 0, collided: 0 } };
      return { ok: true, pipeline_result_json: JSON.stringify(result), plan_json: JSON.stringify(plan) };
    },
    async warm_up() {},
    cancel() {},
  };
}

/** A device with remembering on and unlocked, whose engine reads `results` in turn. */
async function rememberingDevice(results) {
  const environment = vaultEnvironment();
  repo.useEngineForTests(engineFor(results));
  await remember.startRemember({
    openVault: () => openVaultWithIterations(TEST_ITERATIONS, environment),
    core: storeCoreFrom(core.call),
  });
  await remember.turnOnRemember({ passphrase: PASSPHRASE, confirmation: PASSPHRASE, hint: "" });
  return environment;
}

const pdf = () => new File([new Uint8Array([0x25, 0x50])], "statement.pdf", { type: "application/pdf" });

/** Read one statement and return the merge proposal. */
async function proposal() {
  const read = await repo.readStatement(pdf(), "");
  assert.equal(read.kind, "merge");
  return read.proposal;
}

/** The visible text of rendered HTML. */
function textOf(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

test("with remember off, a statement is read into the session as before, with no merge", async () => {
  repo.useEngineForTests(engineFor([pipelineResult(rows(1, 3))]));
  const read = await repo.readStatement(pdf(), "");
  assert.equal(read.kind, "created");
  assert.equal(read.created.import.transaction_count, 3);
});

test("the merge shows new, matched and collided counts before anything is written (N-26)", async () => {
  const environment = await rememberingDevice([pipelineResult(rows(1, 3))]);
  const before = await dumpDatabases(environment.indexedDB);
  const proposed = await proposal();
  assert.deepEqual(proposed.counts, { new: 3, matched: 0, collided: 0 });
  assert.equal(proposed.newLedger, true);
  assert.equal(proposed.differentAccount, false);
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
});

test("cancel writes nothing (N-26)", async () => {
  const environment = await rememberingDevice([pipelineResult(rows(1, 3))]);
  const before = await dumpDatabases(environment.indexedDB);
  (await proposal()).cancel();
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
  assert.deepEqual(await repo.listImports(), { items: [] });
});

test("confirm writes the statement and gives its import and the counts", async () => {
  await rememberingDevice([pipelineResult(rows(1, 3))]);
  const saved = await (await proposal()).confirm();
  assert.deepEqual(saved.counts, { new: 3, matched: 0, collided: 0 });
  assert.deepEqual((await repo.listImports()).items, [saved.created.import]);
});

test("a second overlapping statement shows what it adds and what is already saved (N-25)", async () => {
  await rememberingDevice([pipelineResult(rows(1, 4)), pipelineResult(rows(3, 6))]);
  await (await proposal()).confirm();
  const second = await proposal();
  assert.deepEqual(second.counts, { new: 2, matched: 2, collided: 0 });
  assert.equal(second.newLedger, false);
  assert.equal(second.differentAccount, false);
});

test("after a commit with a collision, the summary carries the collision count (N-27)", async () => {
  await rememberingDevice([pipelineResult(rows(1, 2)), pipelineResult([row(2, { balance: 7 })])]);
  await (await proposal()).confirm();
  const saved = await (await proposal()).confirm();
  assert.deepEqual(saved.counts, { new: 0, matched: 0, collided: 1 });
  assert.deepEqual(saved.created.import.observation_counts, { COLLISION: 1 });
});

test("a statement from a different account is proposed as a separate ledger and opens as one (N-19)", async () => {
  await rememberingDevice([pipelineResult(rows(1, 3)), pipelineResult(rows(2, 4), { digest: OTHER_DIGEST })]);
  const first = await (await proposal()).confirm();
  const other = await proposal();
  assert.equal(other.differentAccount, true);
  assert.equal(other.newLedger, true);
  assert.deepEqual(other.counts, { new: 3, matched: 0, collided: 0 });
  await other.confirm();
  const store = remember.rememberedStoreForTests();
  assert.equal((await store.listLedgers()).length, 2);
  assert.equal((await repo.listImports()).items.length, 1, "the screen now shows the other account's ledger");
  await remember.switchLedger((await store.listLedgers()).find((ledger) => ledger.ledgerId !== store.currentLedgerId()).ledgerId);
  assert.deepEqual((await repo.listImports()).items, [first.created.import]);
});

test("a merge proposal never offers to replace anything", async () => {
  await rememberingDevice([pipelineResult(rows(1, 3)), pipelineResult(rows(2, 4), { digest: OTHER_DIGEST })]);
  await (await proposal()).confirm();
  const other = await proposal();
  assert.deepEqual(Object.keys(other).sort(), ["cancel", "chooseLedger", "confirm", "counts", "differentAccount", "ledgerChoices", "newLedger", "accountUnreadable"].sort());
});

test("a statement with no readable account is added only to the ledger the person picks (N-21)", async () => {
  await rememberingDevice([pipelineResult(rows(1, 3)), pipelineResult(rows(3, 4), { digest: null })]);
  await (await proposal()).confirm();
  const unreadable = await proposal();
  assert.equal(unreadable.accountUnreadable, true);
  assert.equal(unreadable.counts, null);
  assert.equal(unreadable.ledgerChoices.length, 1);
  const chosen = await unreadable.chooseLedger(unreadable.ledgerChoices[0].ledgerId);
  assert.deepEqual(chosen.counts, { new: 1, matched: 1, collided: 0 });
  await chosen.confirm();
  assert.equal((await repo.listImports()).items.length, 2);
});

test("a failed write tells the person and saves nothing (N-28, N-33)", async () => {
  const environment = await rememberingDevice([pipelineResult(rows(1, 3))]);
  const proposed = await proposal();
  const before = await dumpDatabases(environment.indexedDB);
  IDBObjectStore.prototype.put = function failingPut() {
    throw new DOMException("simulated quota", "QuotaExceededError");
  };
  await assert.rejects(() => proposed.confirm(), (error) => error.code === "save_failed" && /not enough storage space/.test(error.message));
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
});

test("the upload flow sends a remembered statement to the merge screen, and a session one to its summary", async () => {
  repo.useEngineForTests(engineFor([pipelineResult(rows(1, 2))]));
  flow.setPendingUpload(pdf(), "");
  assert.deepEqual(await flow.submitPendingStatement(), { next: "/analysis-summary?import=1" });
  await rememberingDevice([pipelineResult(rows(1, 2))]);
  flow.setPendingUpload(pdf(), "");
  assert.deepEqual(await flow.submitPendingStatement(), { next: "/merge" });
  assert.deepEqual(flow.pendingMerge().counts, { new: 2, matched: 0, collided: 0 });
});

test("the merge screen shows the three counts and says nothing is saved until confirmed", () => {
  const text = textOf(
    renderToString(
      createElement(MergeReview, {
        proposal: { counts: { new: 3, matched: 2, collided: 1 }, newLedger: false, differentAccount: false, accountUnreadable: false, ledgerChoices: [] },
        onConfirm() {},
        onCancel() {},
        onChoose() {},
      }),
    ),
  );
  for (const label of [copy.newLabel, copy.matchedLabel, copy.collidedLabel, copy.description, copy.confirmLabel, copy.cancelLabel, copy.collidedHelp]) {
    assert.ok(text.includes(label), label);
  }
  assert.match(text, new RegExp(`${copy.newLabel} 3`));
  assert.match(text, new RegExp(`${copy.matchedLabel} 2`));
  assert.match(text, new RegExp(`${copy.collidedLabel} 1`));
});

test("for a different account the merge screen offers a separate ledger, and never a replace", () => {
  const text = textOf(
    renderToString(
      createElement(MergeReview, {
        proposal: { counts: { new: 3, matched: 0, collided: 0 }, newLedger: true, differentAccount: true, accountUnreadable: false, ledgerChoices: [] },
        onConfirm() {},
        onCancel() {},
        onChoose() {},
      }),
    ),
  );
  assert.ok(text.includes(copy.differentAccountTitle));
  assert.ok(text.includes(copy.confirmSeparateLabel));
  assert.equal(/replace/i.test(text.replace(copy.differentAccountBody, "")), false);
});

test("no screen copy offers to replace saved data", async () => {
  const content = await import("../src/content/remember.ts");
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "function") texts.push(String(value(1, 2, 3)));
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(content);
  const offers = texts.filter((text) => text !== content.claims.noReplace);
  assert.deepEqual(offers.filter((text) => /replace/i.test(text)), []);
});

test("for an unreadable account the merge screen offers the saved ledgers, or not saving", () => {
  const html = renderToString(
    createElement(MergeReview, {
      proposal: {
        counts: null,
        newLedger: false,
        differentAccount: false,
        accountUnreadable: true,
        ledgerChoices: [{ ledgerId: "a".repeat(64), statementCount: 2, period: { start: "2026-01-02 10:00:00", end: "2026-01-09 10:00:00" } }],
      },
      onConfirm() {},
      onCancel() {},
      onChoose() {},
    }),
  );
  const text = textOf(html);
  assert.ok(text.includes(copy.unreadableTitle));
  assert.ok(text.includes(copy.chooseLedgerLabel));
  assert.ok(text.includes(copy.cancelLabel));
  assert.equal(text.includes(copy.confirmLabel + " "), false);
});

test("after a commit, the summary gives the counts and the collision count", () => {
  const text = textOf(
    renderToString(createElement(MergeSaved, { counts: { new: 4, matched: 2, collided: 1 }, importId: 9 })),
  );
  assert.ok(text.includes(copy.savedSummary(4, 2, 1)));
  assert.ok(text.includes(copy.collisionCount(1)));
  assert.ok(text.includes(copy.viewAnalysis));
});

test("the ledger switcher lists each account's ledger, marks the one shown, and offers to switch", () => {
  const ledgers = [
    { ledgerId: "a".repeat(64), statementCount: 2, period: { start: "2026-01-02 10:00:00", end: "2026-01-09 10:00:00" } },
    { ledgerId: "b".repeat(64), statementCount: 1, period: { start: "2026-02-02 10:00:00", end: "2026-02-05 10:00:00" } },
  ];
  const text = textOf(renderToString(createElement(LedgerSwitcher, { ledgers, currentLedgerId: "a".repeat(64), onSwitch() {} })));
  assert.ok(text.includes(settings.currentLedger));
  assert.equal(text.split(settings.switchLabel).length - 1, 1, "one switch button: for the ledger not shown");
  assert.ok(text.includes(settings.ledgerLabel("2 Jan 2026", "9 Jan 2026", 2)));
});
