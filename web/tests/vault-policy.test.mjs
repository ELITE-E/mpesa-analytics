// CP9a item 1: the passphrase policy and the hint rules (N-07, N-09 to N-12). Every value here is
// invented. A refusal names its reason with a code and plain words, never the passphrase.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-policy.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

const { checkPassphrase, checkHint, HINT_MAX_LENGTH } = await import(
  "../src/persistence/passphrase-policy.ts"
);

/** Assert a refusal with `code`, whose message never holds `secret`. */
function assertRefused(verdict, code, secret) {
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, code);
  assert.equal(typeof verdict.message, "string");
  assert.ok(verdict.message.length > 0);
  if (secret) assert.equal(verdict.message.includes(secret), false, "the message holds the passphrase");
}

test("four words are accepted", () => {
  assert.deepEqual(checkPassphrase("lantern orbit pebble canyon"), { ok: true });
});

test("sixteen characters without spaces are accepted", () => {
  assert.deepEqual(checkPassphrase("Tq7#mVr2kLp9xWz4"), { ok: true });
});

test("three words under sixteen characters are refused as too short, with the reason", () => {
  const passphrase = "lamp tree cup";
  assertRefused(checkPassphrase(passphrase), "PASSPHRASE_TOO_SHORT", passphrase);
});

test("fifteen characters in one word are refused as too short", () => {
  assertRefused(checkPassphrase("Tq7#mVr2kLp9xWz"), "PASSPHRASE_TOO_SHORT", "Tq7#mVr2kLp9xWz");
});

test("four one-letter words do not count as four words", () => {
  assertRefused(checkPassphrase("a b c d"), "PASSPHRASE_TOO_SHORT", "a b c d");
});

test("an empty passphrase is refused as too short", () => {
  assertRefused(checkPassphrase(""), "PASSPHRASE_TOO_SHORT");
});

test("one character repeated is refused as a trivial repeat", () => {
  assertRefused(checkPassphrase("aaaaaaaaaaaaaaaaaaaa"), "PASSPHRASE_TRIVIAL_REPEAT", "aaaa");
});

test("one word repeated four times is refused as a trivial repeat", () => {
  assertRefused(checkPassphrase("orbit orbit orbit orbit"), "PASSPHRASE_TRIVIAL_REPEAT", "orbit");
});

test("a short pattern repeated is refused as a trivial repeat, whatever the case", () => {
  assertRefused(checkPassphrase("abcABCabcABCabcABC"), "PASSPHRASE_TRIVIAL_REPEAT", "abc");
});

test("too few different characters are refused as a trivial repeat", () => {
  assertRefused(checkPassphrase("1111222233334444"), "PASSPHRASE_TRIVIAL_REPEAT", "1111");
});

test("a passphrase that is not a string is refused as too short", () => {
  assertRefused(checkPassphrase(undefined), "PASSPHRASE_TOO_SHORT");
});

test("no hint is allowed: the hint is optional", () => {
  assert.deepEqual(checkHint(null, "lantern orbit pebble canyon"), { ok: true, hint: null });
  assert.deepEqual(checkHint(undefined, "lantern orbit pebble canyon"), { ok: true, hint: null });
});

test("an empty or blank hint means no hint", () => {
  assert.deepEqual(checkHint("   ", "lantern orbit pebble canyon"), { ok: true, hint: null });
});

test("a hint with no word of the passphrase is accepted, trimmed", () => {
  assert.deepEqual(checkHint("  the trip to the coast  ", "lantern orbit pebble canyon"), {
    ok: true,
    hint: "the trip to the coast",
  });
});

test("a hint of exactly 60 characters is accepted", () => {
  const hint = "z".repeat(HINT_MAX_LENGTH);
  assert.equal(HINT_MAX_LENGTH, 60);
  assert.deepEqual(checkHint(hint, "lantern orbit pebble canyon"), { ok: true, hint });
});

test("a hint longer than 60 characters is refused", () => {
  assertRefused(checkHint("z".repeat(61), "lantern orbit pebble canyon"), "HINT_TOO_LONG");
});

test("a hint holding any word of the passphrase is refused, whatever the case", () => {
  const passphrase = "lantern orbit pebble canyon";
  assertRefused(checkHint("my PEBBLE from the beach", passphrase), "HINT_CONTAINS_PASSPHRASE_WORD", "pebble");
});

test("a hint holding a word of the passphrase inside a longer word is refused", () => {
  assertRefused(
    checkHint("orbital mechanics", "lantern orbit pebble canyon"),
    "HINT_CONTAINS_PASSPHRASE_WORD",
    "orbit",
  );
});

test("a hint that is the passphrase itself is refused", () => {
  const passphrase = "Tq7#mVr2kLp9xWz4";
  assertRefused(checkHint(passphrase, passphrase), "HINT_CONTAINS_PASSPHRASE_WORD", passphrase);
});
