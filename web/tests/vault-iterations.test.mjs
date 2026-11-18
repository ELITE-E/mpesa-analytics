// CP9a item 6: speed in tests without weakening production. `openVaultWithIterations` takes the
// count so unit tests stay fast; these guards prove `openVault`, the factory the app uses, derives
// with at least 600,000 iterations and that nothing else can lower it: not an option, not a stored
// parameter, not an app source calling the test factory.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-iterations.test.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { PASSPHRASE, TEST_ITERATIONS, dumpDatabases, vaultEnvironment } from "./support/vault-environment.mjs";

const { openVault, openVaultWithIterations, PRODUCTION_KDF_ITERATIONS, VAULT_DATABASE_NAME } = await import(
  "../src/persistence/vault.ts"
);
const { VaultError } = await import("../src/persistence/vault-errors.ts");

const FLOOR = 600_000;
const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..");

/** Node's WebCrypto, recording the PBKDF2 iterations of every key derivation. */
function recordingCrypto() {
  const derivations = [];
  const subtle = new Proxy(globalThis.crypto.subtle, {
    get(target, property) {
      if (property === "deriveKey") {
        return (algorithm, ...rest) => {
          derivations.push(algorithm.iterations);
          return target.deriveKey(algorithm, ...rest);
        };
      }
      const member = target[property];
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { derivations, crypto: { subtle, getRandomValues: (array) => globalThis.crypto.getRandomValues(array) } };
}

/** Change the stored meta record outside the vault. */
async function rewriteMeta(factory, change) {
  const database = await new Promise((resolve, reject) => {
    const request = factory.open(VAULT_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = database.transaction("meta", "readonly").objectStore("meta").get("vault");
  const meta = await new Promise((resolve) => (read.onsuccess = () => resolve(read.result)));
  const transaction = database.transaction("meta", "readwrite");
  transaction.objectStore("meta").put(change(meta), "vault");
  await new Promise((resolve) => (transaction.oncomplete = resolve));
  database.close();
}

/** Run `action` and return the VaultError it throws. */
async function vaultErrorFrom(action) {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof VaultError, `expected a VaultError, got ${error}`);
    return error;
  }
  assert.fail("expected a VaultError");
}

/** Every .ts, .tsx, .js and .mjs file under `directory`, skipping dependencies and build output. */
function sourceFiles(directory) {
  const skipped = new Set(["node_modules", ".next", "out", "public"]);
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return skipped.has(name) ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

test("the production iteration count is at least 600,000", () => {
  assert.ok(PRODUCTION_KDF_ITERATIONS >= FLOOR);
});

test("the production factory derives the key with at least 600,000 iterations and stores that count", async () => {
  const { derivations, crypto } = recordingCrypto();
  const environment = vaultEnvironment({ crypto });
  const vault = await openVault(environment);
  await vault.create(PASSPHRASE);
  assert.deepEqual(derivations, [PRODUCTION_KDF_ITERATIONS]);
  const meta = (await dumpDatabases(environment.indexedDB)).find((record) => record.store === "meta").value;
  assert.ok(meta.kdf.iterations >= FLOOR);
});

test("an iteration option passed to the production factory is ignored", async () => {
  const { derivations, crypto } = recordingCrypto();
  const vault = await openVault({ ...vaultEnvironment({ crypto }), iterations: 1, kdfIterations: 1 });
  await vault.create(PASSPHRASE);
  assert.ok(derivations.every((iterations) => iterations >= FLOOR), String(derivations));
});

test("the production vault refuses stored parameters below 600,000 iterations without deriving a key", async () => {
  const environment = vaultEnvironment();
  const weak = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await weak.create(PASSPHRASE);
  weak.lock();
  const { derivations, crypto } = recordingCrypto();
  const vault = await openVault({ ...environment, crypto });
  const error = await vaultErrorFrom(() => vault.unlock(PASSPHRASE));
  assert.equal(error.code, "KDF_PARAMETERS_REFUSED");
  assert.deepEqual(derivations, []);
  assert.equal(vault.status().locked, true);
});

test("lowering the stored iteration count is refused, never followed", async () => {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(4 * TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE);
  vault.lock();
  await rewriteMeta(environment.indexedDB, (meta) => ({ ...meta, kdf: { ...meta.kdf, iterations: TEST_ITERATIONS } }));
  const later = await openVaultWithIterations(4 * TEST_ITERATIONS, environment);
  assert.equal((await vaultErrorFrom(() => later.unlock(PASSPHRASE))).code, "KDF_PARAMETERS_REFUSED");
});

test("a stored key derivation other than PBKDF2 with SHA-256 is refused", async () => {
  for (const kdf of [
    { name: "PBKDF2", hash: "SHA-1", iterations: TEST_ITERATIONS },
    { name: "HKDF", hash: "SHA-256", iterations: TEST_ITERATIONS },
    { name: "PBKDF2", hash: "SHA-256", iterations: "1000" },
  ]) {
    const environment = vaultEnvironment();
    const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
    await vault.create(PASSPHRASE);
    vault.lock();
    await rewriteMeta(environment.indexedDB, (meta) => ({ ...meta, kdf }));
    const later = await openVaultWithIterations(TEST_ITERATIONS, environment);
    assert.equal((await vaultErrorFrom(() => later.unlock(PASSPHRASE))).code, "KDF_PARAMETERS_REFUSED", JSON.stringify(kdf));
  }
});

test("the test factory refuses an iteration count that is not a positive whole number", async () => {
  for (const iterations of [0, -5, 1.5, Number.NaN, "1000"]) {
    await assert.rejects(() => openVaultWithIterations(iterations, vaultEnvironment()), RangeError, String(iterations));
  }
});

test("no app source uses the test factory: the app can only reach the production one", () => {
  const callers = [...sourceFiles(join(WEB, "src")), ...sourceFiles(join(REPO, "pdf_reader"))]
    .filter((path) => readFileSync(path, "utf8").includes("openVaultWithIterations"))
    .map((path) => relative(REPO, path));
  assert.deepEqual(callers, ["web/src/persistence/vault.ts"]);
});
