// CP9c: every claim the "Remember on this device" screens make has a test behind it. Each entry
// of `claims` (src/content/remember.ts) names the test that proves it, by file and exact test
// name; this file checks that the test exists, that no claim is left without one, and that the
// screens' copy states its claims through `claims` rather than in words of its own. The few
// claims no other test pins are proved here.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/remember-claims.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PASSPHRASE, TEST_ITERATIONS, dumpDatabases, holdsBytes, vaultEnvironment } from "./support/vault-environment.mjs";

const content = await import("../src/content/remember.ts");
const { checkPassphrase } = await import("../src/persistence/passphrase-policy.ts");
const { openVaultWithIterations, Vault } = await import("../src/persistence/vault.ts");

const WEB = join(import.meta.dirname, "..");
const HERE = "tests/remember-claims.test.mjs";

/** Each claim and the test that proves it: [file under web/, exact test name]. */
const PROOFS = {
  lockedWithPassphrase: ["tests/vault-never-stored.test.mjs", "after a full save, neither the decrypted ledger nor the raw database holds a secret (N-02, N-13)"],
  nothingSavedUnlessOn: ["tests/vault-never-stored.test.mjs", "with remember off, saving a whole session writes nothing: storage stays empty (N-14)"],
  neverSaved: ["tests/vault-never-stored.test.mjs", "the whole in-memory session is refused, and the database holds none of its secrets"],
  accountsApart: ["tests/store-ledgers.test.ts", "a statement from a different account opens a separate ledger and is never compared (N-19)"],
  autoLock: ["tests/remember-e2e.test.mjs", "after ten idle minutes the app locks itself and says so"],
  keepStorage: ["tests/vault-never-stored.test.mjs", "persistent storage is requested once, when the person opts in, and never otherwise (N-17)"],
  openWhileUnlocked: ["tests/vault-lock.test.mjs", "unlock with the right passphrase opens what was saved"],
  downloadsNotLocked: [HERE, "a CSV export is an ordinary download that never goes through the vault"],
  weakPassphrase: [HERE, "the policy refuses trivial repeats but cannot tell a guessable phrase"],
  noRecovery: [HERE, "nothing can recover a forgotten passphrase: the vault has no reset, and delete-all works while locked"],
  hintPlain: [HERE, "the hint is stored without encryption"],
  hintAfterFailure: ["tests/vault-lock.test.mjs", "the hint is shown only after a failed unlock, and hidden again after a good one (N-11)"],
  nothingWrittenUntilConfirmed: ["tests/remember-merge.test.mjs", "the merge shows new, matched and collided counts before anything is written (N-26)"],
  collisionsKept: ["tests/store.test.ts", "test_collision_preserves_both_rows_and_leaves_the_original_unchanged"],
  noReplace: ["tests/remember-merge.test.mjs", "a merge proposal never offers to replace anything"],
  deleteRemovesAll: ["tests/vault-lock.test.mjs", "delete-all removes the whole database: ledgers, salt, hint and settings (N-16)"],
  removeTakesOnlyItsRows: ["tests/remember-settings.test.mjs", "removing a statement takes it and the rows only it printed out of the ledger"],
};

test("every claim the copy makes names a test that proves it, and that test exists", () => {
  assert.deepEqual(Object.keys(content.claims).sort(), Object.keys(PROOFS).sort());
  for (const [claim, [file, name]] of Object.entries(PROOFS)) {
    const source = readFileSync(join(WEB, file), "utf8");
    assert.ok(source.includes(JSON.stringify(name)) || source.includes(`"${name}"`) || source.includes(`\`${name}\``), `${claim}: ${file} has no test "${name}"`);
  }
});

test("the screens state their claims through the claims list, not in words of their own", () => {
  const { claims, rememberCard, merge, unlock, deleteAll, settings } = content;
  assert.equal(rememberCard.hintWarning, claims.hintPlain);
  assert.equal(merge.description, claims.nothingWrittenUntilConfirmed);
  assert.equal(merge.collidedHelp, claims.collisionsKept);
  assert.equal(merge.differentAccountBody, claims.noReplace);
  assert.equal(unlock.forgotBody, claims.noRecovery);
  assert.ok(deleteAll.body.includes(claims.deleteRemovesAll));
  assert.ok(settings.removeQuestion.includes(claims.removeTakesOnlyItsRows));
  for (const id of [...rememberCard.protects, ...rememberCard.limits]) assert.ok(id in claims, id);
});

test("a CSV export is an ordinary download that never goes through the vault", () => {
  for (const file of ["src/lib/download-csv.ts", "src/lib/ledger-csv.ts"]) {
    const source = readFileSync(join(WEB, file), "utf8");
    assert.equal(/persistence|remember|vault/i.test(source), false, `${file} touches the vault`);
  }
  assert.match(readFileSync(join(WEB, "src/lib/download-csv.ts"), "utf8"), /createObjectURL/);
});

test("the policy refuses trivial repeats but cannot tell a guessable phrase", () => {
  assert.equal(checkPassphrase("password password password password").ok, false);
  assert.equal(checkPassphrase("the quick brown fox").ok, true, "a famous phrase meets the policy, so the copy warns about it");
});

test("nothing can recover a forgotten passphrase: the vault has no reset, and delete-all works while locked", async () => {
  const methods = Object.getOwnPropertyNames(Vault.prototype);
  assert.deepEqual(methods.filter((name) => /reset|recover|change|rekey/i.test(name)), []);
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE);
  vault.lock();
  await vault.deleteAll();
  assert.deepEqual(await environment.indexedDB.databases(), []);
});

test("the hint is stored without encryption", async () => {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE, { hint: "the trip to the coast" });
  assert.equal(holdsBytes(await dumpDatabases(environment.indexedDB), "the trip to the coast"), true);
});
