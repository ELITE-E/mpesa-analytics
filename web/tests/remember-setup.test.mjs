// CP9c item 1: the "Remember on this device" card and turning it on (N-07, N-09, N-12, N-14,
// N-17, N-32). The controller (src/lib/remember.ts) runs over fake IndexedDB with a low iteration
// count; the card is rendered as the static export renders it. Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/remember-setup.test.mjs

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { PASSPHRASE, TEST_ITERATIONS, databaseNames, vaultEnvironment } from "./support/vault-environment.mjs";

const remember = await import("../src/lib/remember.ts");
const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { claims, rememberCard } = await import("../src/content/remember.ts");
const { RememberCard, RememberSetupForm } = await import("../src/components/remember/remember-card.tsx");
const repo = await import("../src/data/repo.ts");

afterEach(() => remember.resetRememberForTests());

/** Start the controller over a fresh fake device. */
async function started(overrides = {}) {
  const environment = vaultEnvironment(overrides);
  await remember.startRemember({ openVault: () => openVaultWithIterations(TEST_ITERATIONS, environment) });
  return environment;
}

/** The visible text of rendered HTML. */
function textOf(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

test("before it starts the controller says so, and once started remembering is off by default", async () => {
  assert.equal(remember.rememberView().phase, "starting");
  const environment = await started();
  assert.equal(remember.rememberView().phase, "off");
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("turning on asks for the passphrase twice: two different ones are refused and nothing is written", async () => {
  const environment = await started();
  await assert.rejects(
    () => remember.turnOnRemember({ passphrase: PASSPHRASE, confirmation: "lantern orbit pebble canyons", hint: "" }),
    (error) => error.code === "PASSPHRASES_DIFFER" && error.message === rememberCard.passphrasesDiffer,
  );
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
  assert.equal(remember.rememberView().phase, "off");
});

test("a passphrase below the policy is refused with its reason and nothing is written", async () => {
  const environment = await started();
  await assert.rejects(
    () => remember.turnOnRemember({ passphrase: "lamp tree cup", confirmation: "lamp tree cup", hint: "" }),
    (error) => error.code === "PASSPHRASE_TOO_SHORT" && /four words/.test(error.message),
  );
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
});

test("a hint holding a word of the passphrase, or longer than 60 characters, is refused", async () => {
  await started();
  for (const [hint, code] of [
    ["pebble beach", "HINT_CONTAINS_PASSPHRASE_WORD"],
    ["z".repeat(61), "HINT_TOO_LONG"],
  ]) {
    await assert.rejects(
      () => remember.turnOnRemember({ passphrase: PASSPHRASE, confirmation: PASSPHRASE, hint }),
      (error) => error.code === code,
    );
  }
});

test("turning on unlocks, asks the browser to keep the data once, and the data layer starts remembering", async () => {
  const environment = await started();
  assert.equal(environment.storageManager.requests, 0);
  await remember.turnOnRemember({ passphrase: PASSPHRASE, confirmation: PASSPHRASE, hint: "the trip to the coast" });
  assert.equal(remember.rememberView().phase, "unlocked");
  assert.equal(environment.storageManager.requests, 1);
  assert.deepEqual(await repo.listImports(), { items: [] });
  assert.deepEqual(await databaseNames(environment.indexedDB), ["mpesa-analytics-vault"]);
});

test("with storage blocked, the card says saving is not available and why", async () => {
  await started({ indexedDB: null });
  const view = remember.rememberView();
  assert.equal(view.phase, "unavailable");
  assert.match(view.storageMessage, /private window/);
  const text = textOf(renderToString(createElement(RememberCard, { view })));
  assert.ok(text.includes(rememberCard.unavailableTitle));
  assert.ok(text.includes(view.storageMessage));
  assert.equal(text.includes(rememberCard.turnOnLabel), false);
});

test("the card is off by default and explains what the lock protects and what it does not", () => {
  const text = textOf(renderToString(createElement(RememberCard, { view: { phase: "off" } })));
  assert.ok(text.includes(rememberCard.title));
  assert.ok(text.includes(rememberCard.offBadge));
  assert.ok(text.includes(rememberCard.intro));
  for (const claim of [...rememberCard.protects, ...rememberCard.limits]) assert.ok(text.includes(claims[claim]), claim);
  assert.ok(text.includes(rememberCard.turnOnLabel));
  assert.equal(/type="password"/.test(renderToString(createElement(RememberCard, { view: { phase: "off" } }))), false);
});

test("the setup form asks for the passphrase twice and warns that the hint is stored unencrypted", () => {
  const html = renderToString(createElement(RememberSetupForm, { onSubmit: () => {}, onCancel: () => {}, error: null }));
  assert.equal(html.match(/type="password"/g).length, 2);
  const text = textOf(html);
  for (const label of [rememberCard.passphraseLabel, rememberCard.confirmLabel, rememberCard.hintLabel, rememberCard.submitLabel]) {
    assert.ok(text.includes(label), label);
  }
  assert.ok(text.includes(claims.hintPlain));
  assert.ok(text.includes(rememberCard.passphraseHelp));
  assert.match(html, /maxLength="60"/);
});

test("once on, the card says so and offers no setup", () => {
  const text = textOf(renderToString(createElement(RememberCard, { view: { phase: "unlocked" } })));
  assert.ok(text.includes(rememberCard.onBadge));
  assert.equal(text.includes(rememberCard.turnOnLabel), false);
});
