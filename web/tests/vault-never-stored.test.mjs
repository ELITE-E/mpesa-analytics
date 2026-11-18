// CP9a item 4: what is never stored (N-02, N-13, N-14, N-17). Every value below is invented: PDF
// bytes, a PDF password, a verification token, an account digest, a mobile number, a customer name
// and an email address. A save that would carry any of them is refused and writes nothing; a
// recursive scan of the decrypted ledger and of the raw database finds none of them.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/vault-never-stored.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PASSPHRASE,
  TEST_ITERATIONS,
  databaseNames,
  dumpDatabases,
  holdsBytes,
  vaultEnvironment,
} from "./support/vault-environment.mjs";

const { openVaultWithIterations } = await import("../src/persistence/vault.ts");
const { VaultError } = await import("../src/persistence/vault-errors.ts");

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Invented true >> endobj\n%%EOF\n");
const PDF_PASSWORD = "Invented-Pdf-Pass-4821";
const VERIFICATION_TOKEN = "Q7RT" + "2KX9";
const ACCOUNT_DIGEST = "5e1f".repeat(16);
const MOBILE_NUMBER = "254700000" + "123";
const CUSTOMER_NAME = "Invented Wanjiku Example";
const EMAIL = "invented.person" + "@" + "example.invalid";
const SECRETS = { PDF_PASSWORD, VERIFICATION_TOKEN, ACCOUNT_DIGEST, MOBILE_NUMBER, CUSTOMER_NAME, EMAIL };

const TRANSACTIONS = [
  { receipt_no: "ZZ" + "00AA11BB", completion_time: "2025-03-01 09:15:00", details: "Invented Shop", paid_in: 0, paid_out: 120 },
  { receipt_no: "ZZ" + "00AA11BC", completion_time: "2025-03-02 18:40:12", details: "Invented Kiosk", paid_in: 500, paid_out: 0 },
];

/** A session as the app holds it in memory: everything, including what must never be stored. */
function wholeSession() {
  return {
    upload: { pdf_bytes: PDF_BYTES, password: PDF_PASSWORD },
    account: { account_digest: ACCOUNT_DIGEST, mobile_number: MOBILE_NUMBER, customer_name: CUSTOMER_NAME, email: EMAIL },
    pipeline_result: {
      verification_token: VERIFICATION_TOKEN,
      period: { start: "2025-03-01", end: "2025-03-02" },
      transactions: TRANSACTIONS,
      quality: { unclassified_rows: 0 },
    },
  };
}

/** The part of a session that may be stored: the rows and the period, nothing about the person. */
function storableLedger() {
  const { pipeline_result: result } = wholeSession();
  return { statements: [{ period: result.period, quality: result.quality }], transactions: result.transactions };
}

/** A created, unlocked vault over a fresh environment. */
async function createdVault() {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vault.create(PASSPHRASE, { hint: "the trip to the coast" });
  return { vault, environment };
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

/** Assert that nothing in `value` holds PDF bytes or any invented secret. */
function assertHoldsNoSecret(value, where) {
  assert.equal(holdsBytes(value, "%PDF"), false, `${where} holds PDF bytes`);
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.equal(holdsBytes(value, secret), false, `${where} holds ${name}`);
  }
}

test("with remember off, saving a whole session writes nothing: storage stays empty (N-14)", async () => {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  assert.deepEqual(await vault.saveLedger("ledger-one", wholeSession()), { saved: false, reason: "REMEMBER_OFF" });
  assert.deepEqual(await databaseNames(environment.indexedDB), []);
  assert.equal(environment.storageManager.requests, 0);
});

test("persistent storage is requested once, when the person opts in, and never otherwise (N-17)", async () => {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  assert.equal(environment.storageManager.requests, 0);
  await vault.create(PASSPHRASE);
  assert.equal(environment.storageManager.requests, 1);
  await vault.saveLedger("ledger-one", storableLedger());
  vault.lock();
  const later = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await later.unlock(PASSPHRASE);
  await later.readLedger("ledger-one");
  assert.equal(environment.storageManager.requests, 1);
});

test("a refused opt-in requests no persistent storage", async () => {
  const environment = vaultEnvironment();
  const vault = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await vaultErrorFrom(() => vault.create("lamp tree cup"));
  assert.equal(environment.storageManager.requests, 0);
});

const FORBIDDEN_PLACEMENTS = [
  ["PDF bytes as a Uint8Array", { attachment: PDF_BYTES }, "pdf_bytes"],
  ["PDF bytes as an ArrayBuffer", { statement: PDF_BYTES.slice().buffer }, "pdf_bytes"],
  ["PDF bytes as text", { notes: new TextDecoder().decode(PDF_BYTES) }, "pdf_bytes"],
  ["any other binary value", { thumbnail: new Uint8Array([1, 2, 3]) }, "binary"],
  ["the PDF password", { password: PDF_PASSWORD }, "pdf_password"],
  ["the PDF password under another name", { upload: { pdfPassword: PDF_PASSWORD } }, "pdf_password"],
  ["the verification token", { statements: [{ verification_token: VERIFICATION_TOKEN }] }, "verification_token"],
  ["the account digest", { account_digest: ACCOUNT_DIGEST }, "account_digest"],
  ["the mobile number", { header: { mobile_number: MOBILE_NUMBER } }, "mobile_number"],
  ["the mobile number as an MSISDN", { header: { msisdn: MOBILE_NUMBER } }, "mobile_number"],
  ["the customer name", { statements: [{ header: { customer_name: CUSTOMER_NAME } }] }, "customer_name"],
  ["the email address under its name", { header: { email: EMAIL } }, "email"],
  ["an email address inside free text", { notes: [`write to ${EMAIL} later`] }, "email"],
];

for (const [what, extra, detail] of FORBIDDEN_PLACEMENTS) {
  test(`a ledger holding ${what} is refused, and the saved ledger is left as it was (N-13)`, async () => {
    const { vault, environment } = await createdVault();
    await vault.saveLedger("ledger-one", storableLedger());
    const before = await dumpDatabases(environment.indexedDB);
    const error = await vaultErrorFrom(() => vault.saveLedger("ledger-one", { ...storableLedger(), ...extra }));
    assert.equal(error.code, "FORBIDDEN_CONTENT");
    assert.equal(error.detail, detail);
    assertHoldsNoSecret({ message: error.message, stack: String(error.stack) }, "the error");
    assert.deepEqual(await dumpDatabases(environment.indexedDB), before);
  });
}

test("the whole in-memory session is refused, and the database holds none of its secrets", async () => {
  const { vault, environment } = await createdVault();
  const error = await vaultErrorFrom(() => vault.saveLedger("ledger-one", wholeSession()));
  assert.equal(error.code, "FORBIDDEN_CONTENT");
  assertHoldsNoSecret(await dumpDatabases(environment.indexedDB), "the raw database");
  assert.equal((await vault.readLedger("ledger-one")), null);
});

test("after a full save, neither the decrypted ledger nor the raw database holds a secret (N-02, N-13)", async () => {
  const { vault, environment } = await createdVault();
  await vault.saveLedger("ledger-one", storableLedger());
  vault.lock();
  const raw = await dumpDatabases(environment.indexedDB);
  assertHoldsNoSecret(raw, "the raw database");
  for (const value of ["Invented Shop", "Invented Kiosk", "ZZ" + "00AA11BB", PASSPHRASE, "pebble"]) {
    assert.equal(holdsBytes(raw, value), false, `the raw database holds ${value}`);
  }
  const later = await openVaultWithIterations(TEST_ITERATIONS, environment);
  await later.unlock(PASSPHRASE);
  const { ledger } = await later.readLedger("ledger-one");
  assert.deepEqual(ledger, storableLedger());
  assertHoldsNoSecret(ledger, "the decrypted ledger");
});

test("ordinary ledger values pass: counterparty names, masked numbers, amounts and times", async () => {
  const { vault } = await createdVault();
  const ledger = {
    transactions: [
      { details: "Customer Transfer to " + "2547" + "*****" + "012" + " Example Person 12", entity: "Example Person 12" },
      { details: "Pay Bill to 400200 Account 77", paid_out: 1500.25, balance: 9.75, completion_time: "2025-03-02 18:40:12" },
    ],
    names: ["Invented Shop"],
  };
  assert.deepEqual(await vault.saveLedger("ledger-one", ledger), { saved: true, version: 1 });
});

test("checking a ledger with a long unbroken text stays fast: 40,000 characters take under a second", async () => {
  const { vault } = await createdVault();
  const longText = "InventedDetails".repeat(40_000 / 15);
  const started = performance.now();
  assert.deepEqual(await vault.saveLedger("ledger-one", { notes: [longText] }), { saved: true, version: 1 });
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
});
