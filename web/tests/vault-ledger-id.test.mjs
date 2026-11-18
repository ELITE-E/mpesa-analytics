// CP9b item 1 (N-18): the ledger id is HMAC(vault key, account digest), computed after unlock.
// The digest is never stored; the id is the only account marker. Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-ledger-id.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { PASSPHRASE, TEST_ITERATIONS, dumpDatabases, holdsBytes, vaultEnvironment } from "./support/vault-environment.mjs";

const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { VaultError } = await import("../src/persistence/vault-errors.ts");

const DIGEST = "5e1f".repeat(16);
const OTHER_DIGEST = "a07c".repeat(16);

/** A created, unlocked vault and its environment. */
async function createdVault(environment = vaultEnvironment()) {
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE);
  return { vault, environment };
}

test("the ledger id is 64 hex characters and is not the digest", async () => {
  const { vault } = await createdVault();
  const ledgerId = await vault.ledgerIdFor(DIGEST);
  assert.match(ledgerId, /^[0-9a-f]{64}$/);
  assert.notEqual(ledgerId, DIGEST);
});

test("the same account gives the same ledger id after lock and unlock, and in another tab", async () => {
  const { vault, environment } = await createdVault();
  const first = await vault.ledgerIdFor(DIGEST);
  vault.lock();
  await vault.unlock(PASSPHRASE);
  assert.equal(await vault.ledgerIdFor(DIGEST), first);
  const otherTab = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await otherTab.unlock(PASSPHRASE);
  assert.equal(await otherTab.ledgerIdFor(DIGEST), first);
});

test("a different account gives a different ledger id", async () => {
  const { vault } = await createdVault();
  assert.notEqual(await vault.ledgerIdFor(DIGEST), await vault.ledgerIdFor(OTHER_DIGEST));
});

test("another vault, even with the same passphrase, gives a different id for the same account", async () => {
  const { vault: first } = await createdVault();
  const { vault: second } = await createdVault();
  assert.notEqual(await first.ledgerIdFor(DIGEST), await second.ledgerIdFor(DIGEST));
});

test("the ledger id cannot be computed while locked, and lock drops its key", async () => {
  const { vault } = await createdVault();
  vault.lock();
  await assert.rejects(() => vault.ledgerIdFor(DIGEST), (error) => error instanceof VaultError && error.code === "LOCKED");
});

test("a digest that is not text is refused without repeating it", async () => {
  const { vault } = await createdVault();
  for (const digest of [null, "", 42]) {
    await assert.rejects(
      () => vault.ledgerIdFor(digest),
      (error) => error instanceof VaultError && error.code === "ACCOUNT_DIGEST_INVALID",
    );
  }
});

test("the digest is never stored: only the ledger id is, as the record's key (N-18)", async () => {
  const { vault, environment } = await createdVault();
  const ledgerId = await vault.ledgerIdFor(DIGEST);
  await vault.saveLedger(ledgerId, { statements: [] });
  const raw = await dumpDatabases(environment.indexedDB);
  assert.equal(holdsBytes(raw, DIGEST), false);
  assert.deepEqual(
    raw.filter((record) => record.store === "ledgers").map((record) => record.key),
    [ledgerId],
  );
});

test("listing ledger ids needs the vault unlocked and names every saved ledger", async () => {
  const { vault } = await createdVault();
  const first = await vault.ledgerIdFor(DIGEST);
  const second = await vault.ledgerIdFor(OTHER_DIGEST);
  await vault.saveLedger(first, { statements: [] });
  await vault.saveLedger(second, { statements: [] });
  assert.deepEqual((await vault.listLedgerIds()).sort(), [first, second].sort());
  vault.lock();
  await assert.rejects(() => vault.listLedgerIds(), (error) => error.code === "LOCKED");
});

test("one key derivation per unlock: the passphrase is stretched once, not once per key", async () => {
  const { environment } = await createdVault();
  let stretches = 0;
  const subtle = new Proxy(globalThis.crypto.subtle, {
    get(target, property) {
      const member = target[property];
      if (typeof member !== "function") return member;
      return (algorithm, ...rest) => {
        if (algorithm?.name === "PBKDF2" && ["deriveKey", "deriveBits"].includes(property)) stretches += 1;
        return member.call(target, algorithm, ...rest);
      };
    },
  });
  const crypto = { subtle, getRandomValues: (array) => globalThis.crypto.getRandomValues(array) };
  const vault = await openVaultWithIterations(TEST_ITERATIONS, { ...environment, crypto });
  await vault.unlock(PASSPHRASE);
  await vault.ledgerIdFor(DIGEST);
  assert.equal(stretches, 1);
});
