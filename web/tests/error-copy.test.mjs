// CP10a item 5: every code the app can show has its own plain message, with no values. A message
// is a fixed string (never built from what failed), in plain words, with no slot a value could
// fill and no technical term. Covered: the engine's, the core's and the data layer's codes (from
// src/data/messages.ts and the core's own enums), every vault and store error, the passphrase and
// hint refusals, and the screens' own refusals.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/error-copy.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const messages = await import("../src/data/messages.ts");
const { VaultError } = await import("../src/persistence/vault-errors.ts");
const { StoreError } = await import("../src/persistence/store-errors.ts");
const { checkHint, checkPassphrase } = await import("../src/persistence/passphrase-policy.ts");
const { rememberCard, unlock } = await import("../src/content/remember.ts");
const { capabilities } = await import("../src/content/capabilities.ts");

const CORE_ERRORS = readFileSync(join(import.meta.dirname, "../../src/mpesa_core/errors.py"), "utf8");
// Core codes that never reach the screen as themselves: the import plan's become the store's
// PLAN_REFUSED or PLAN_FAILED, and the merged analysis's becomes ANALYSIS_FAILED.
const STORE_ONLY_CORE_ENUMS = ["ImportPlanCode"];
const STORE_ONLY_CORE_CODES = ["MERGE_REQUEST_INVALID"];
const TECHNICAL = /\b(exception|traceback|stack|undefined|null|NaN|errno|TypeError|ValueError|indexeddb|pyodide|wasm)\b/i;
const VALUE_SLOT = /\$\{|\{\w*\}|%s|%d|<\w+>/;

/** The member values of a core error enum, read from errors.py. */
function coreCodes(enumName) {
  const body = CORE_ERRORS.slice(CORE_ERRORS.indexOf(`class ${enumName}(Enum):`)).split("\n\n\n")[0];
  return [...body.matchAll(/^\s+([A-Z_]+) = "([A-Z_]+)"/gm)].map((match) => match[2]);
}

/** Assert one message is plain: a fixed sentence, no slot, no technical word. */
function assertPlain(message, where) {
  assert.equal(typeof message, "string", `${where}: a fixed string`);
  assert.ok(message.length >= 15 && message.length <= 260, `${where}: length ${message.length}`);
  assert.match(message, /[.!?]$/, `${where}: a full sentence`);
  assert.equal(VALUE_SLOT.test(message), false, `${where}: a slot for a value`);
  assert.equal(TECHNICAL.test(message), false, `${where}: a technical word`);
}

test("every code the screen can show has its own plain message", () => {
  const codes = [...messages.ENGINE_CODES, ...messages.CORE_CODES, ...messages.LOCAL_CODES];
  const fallback = messages.messageFor("unexpected_error");
  for (const code of codes) {
    const message = messages.messageFor(code);
    assertPlain(message, code);
    if (code !== "unexpected_error") assert.notEqual(message, fallback, `${code} has its own message`);
  }
  assert.equal(new Set(codes.map((code) => messages.messageFor(code))).size, codes.length, "no two codes share a message");
});

test("every code the core can send to the screen is one the screen has a message for", () => {
  const shown = new Set([...messages.ENGINE_CODES, ...messages.CORE_CODES]);
  const enums = ["ErrorCode", "AttestationCode", "AnalysisCode"].filter((name) => !STORE_ONLY_CORE_ENUMS.includes(name));
  for (const code of enums.flatMap(coreCodes).filter((code) => !STORE_ONLY_CORE_CODES.includes(code))) {
    assert.ok(shown.has(code), `${code} has no message`);
  }
});

test("every vault and store error has a plain fixed message", () => {
  const vaultCodes = [...readFileSync(join(import.meta.dirname, "../src/persistence/vault-errors.ts"), "utf8").matchAll(/^\s+([A-Z_]+):/gm)].map((match) => match[1]);
  const storeCodes = [...readFileSync(join(import.meta.dirname, "../src/persistence/store-errors.ts"), "utf8").matchAll(/^\s+([A-Z_]+):/gm)].map((match) => match[1]);
  assert.ok(vaultCodes.length >= 15 && storeCodes.length >= 10);
  for (const code of vaultCodes) assertPlain(new VaultError(code).message, `VaultError ${code}`);
  for (const code of storeCodes) assertPlain(new StoreError(code).message, `StoreError ${code}`);
});

test("passphrase and hint refusals are plain and never repeat what was typed", () => {
  const typed = "lamp tree cup";
  const refusals = [
    checkPassphrase(typed),
    checkPassphrase("aaaaaaaaaaaaaaaaaaaa"),
    checkHint("z".repeat(61), "lantern orbit pebble canyon"),
    checkHint("pebble", "lantern orbit pebble canyon"),
  ];
  for (const refusal of refusals) {
    assertPlain(refusal.message, refusal.code);
    assert.equal(refusal.message.includes("lamp"), false);
    assert.equal(refusal.message.includes("pebble"), false);
  }
});

test("the screens' own refusals and notices are plain", () => {
  for (const [where, message] of [
    ["passphrases differ", rememberCard.passphrasesDiffer],
    ["wrong passphrase", unlock.wrongPassphrase],
    ["capability title", `${capabilities.title}.`],
    ["memory only", capabilities.memoryOnly],
  ]) {
    assertPlain(message, where);
  }
});
