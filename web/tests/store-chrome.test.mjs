// CP9b item 7: the store in real Chrome under the architecture CSP, with the real statement engine
// (pdf.js, Pyodide and the core from the verified runtime) and the production vault. Two synthetic
// statements of one invented account are read, remembered, merged and analysed: during unlock,
// merge, save, merged analysis and delete there are zero requests and zero CSP violations
// (N-34), and the raw database holds no plaintext from the statements. Needs the runtime built
// (tools/vendor.py runtime) and system Chrome.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/store-chrome.test.mjs

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { startVaultPageServer } from "./support/vault-page-server.mjs";

const PASSPHRASE = "lantern orbit pebble canyon";
const ENGINE_TIMEOUT_MS = 240_000;

let server;
let browser;
let page;
let requests;

before(async () => {
  server = await startVaultPageServer();
  browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(ENGINE_TIMEOUT_MS);
  requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on("worker", (worker) => worker.on("request", (request) => requests.push({ url: request.url(), method: request.method() })));
  await page.addInitScript(() => {
    globalThis.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => globalThis.cspViolations.push(event.effectiveDirective));
  });
  await page.goto(`${server.origin}/vault-test.html`);
  // Start the engine and read both statements before the measured window: loading the runtime and
  // fetching the fixture PDFs are the only requests the page makes.
  await page.evaluate(async () => {
    const { create_statement_engine } = await import("/pdf_reader/engine_client.js");
    const pointer = await (await fetch("/runtime/current.json")).json();
    globalThis.engine = create_statement_engine({
      create_worker: () => new Worker("/pdf_reader/reader.worker.js", { type: "module" }),
      runtime_url: `/runtime/${pointer.version}/`,
    });
    const read = async (name) => {
      const bytes = new Uint8Array(await (await fetch(`/fixtures/${name}.pdf`)).arrayBuffer());
      const outcome = await engine.run({ pdf_bytes: bytes, processed_at: "2026-11-18T09:00:00Z" });
      if (!outcome.ok) throw new Error(`engine failed: ${outcome.failure.code}`);
      return JSON.parse(outcome.pipeline_result_json);
    };
    globalThis.results = { golden: await read("F-GOLDEN"), basic: await read("F-BASIC") };
    globalThis.vaultModule = await import("/persistence/vault.js");
    globalThis.storeModule = await import("/persistence/store.js");
    globalThis.coreModule = await import("/persistence/store-core.js");
  });
}, { timeout: ENGINE_TIMEOUT_MS });

after(async () => {
  await browser?.close();
  await server?.close();
});

test("remembering, merging, analysing and deleting make zero requests and break no CSP rule (N-34)", { timeout: ENGINE_TIMEOUT_MS }, async () => {
  requests.length = 0;
  const outcome = await page.evaluate(async (passphrase) => {
    const core = coreModule.storeCoreFrom((name, text) => engine.call_core(name, text));
    const vault = await vaultModule.openVault();
    await vault.create(passphrase);
    const store = storeModule.openLedgerStore(vault, core);
    const first = await store.rememberStatement({ pipelineResult: results.golden, importedAt: "2026-11-18T09:00:00Z" });
    const again = await store.rememberStatement({ pipelineResult: results.golden, importedAt: "2026-11-18T09:05:00Z" });
    const basic = await store.rememberStatement({ pipelineResult: results.basic, importedAt: "2026-11-18T09:10:00Z" });
    const merged = await store.mergedAnalytics();
    vault.lock();
    const unlocked = await vaultModule.openVault();
    await unlocked.unlock(passphrase);
    const reopened = storeModule.openLedgerStore(unlocked, core);
    await reopened.switchLedger(first.ledgerId);
    await reopened.deleteStatement(again.statementId);
    globalThis.ledgerId = first.ledgerId;
    return {
      sameLedger: first.ledgerId === again.ledgerId && again.ledgerId === basic.ledgerId,
      againCounts: again.counts,
      firstCounts: first.counts,
      statements: reopened.currentLedger().statements.length,
      mergedPeriod: merged.period,
      mergedHasReport: Boolean(merged.report.cash_flow),
      goldenRows: results.golden.transactions.length,
    };
  }, PASSPHRASE);
  assert.deepEqual(requests, [], "no request during unlock, merge, save, analysis or delete");
  assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
  assert.equal(outcome.sameLedger, true);
  assert.deepEqual(outcome.firstCounts, { new: outcome.goldenRows, matched: 0, collided: 0 });
  assert.deepEqual(outcome.againCounts, { new: 0, matched: outcome.goldenRows, collided: 0 });
  assert.equal(outcome.statements, 2);
  assert.ok(outcome.mergedPeriod.start && outcome.mergedPeriod.end);
  assert.equal(outcome.mergedHasReport, true);
});

test("the raw database holds no plaintext from the statements, the token or the account digest", { timeout: ENGINE_TIMEOUT_MS }, async () => {
  const found = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(vaultModule.VAULT_DATABASE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = [];
    for (const store of database.objectStoreNames) {
      const all = await new Promise((resolve) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
      });
      values.push(...all);
    }
    database.close();
    const decoder = new TextDecoder("latin1");
    const text = values
      .map((value) => JSON.stringify(value, (_key, field) => (field instanceof Uint8Array ? decoder.decode(field) : field)))
      .join("\n");
    const first = results.golden.transactions[0];
    const needles = {
      receipt: first.receipt_no,
      details: first.details,
      entity: results.golden.transactions.find((transaction) => transaction.entity)?.entity,
      token: results.golden.verification_token,
      digest: results.golden.account_digest,
      eventType: "MERCHANT_PAYMENT",
      ledgerIdIsTheOnlyMarker: null,
    };
    return Object.fromEntries(
      Object.entries(needles)
        .filter(([, needle]) => needle)
        .map(([name, needle]) => [name, text.includes(needle)]),
    );
  });
  for (const [name, present] of Object.entries(found)) assert.equal(present, false, name);
  assert.ok(Object.keys(found).length >= 5);
});

test("a statement whose account cannot be read stays in memory: nothing is written", { timeout: ENGINE_TIMEOUT_MS }, async () => {
  requests.length = 0;
  const outcome = await page.evaluate(async (passphrase) => {
    const core = coreModule.storeCoreFrom((name, text) => engine.call_core(name, text));
    const vault = await vaultModule.openVault();
    await vault.unlock(passphrase);
    const store = storeModule.openLedgerStore(vault, core);
    const before = (await vault.listLedgerIds()).length;
    const result = { ...results.basic, account_digest: null };
    const remembered = await store.rememberStatement({ pipelineResult: result, importedAt: "2026-11-18T10:00:00Z" });
    return { remembered, before, after: (await vault.listLedgerIds()).length };
  }, PASSPHRASE);
  assert.deepEqual(outcome.remembered, { saved: false, reason: "ACCOUNT_UNREADABLE" });
  assert.equal(outcome.after, outcome.before);
  assert.deepEqual(requests, []);
});
