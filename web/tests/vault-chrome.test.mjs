// CP9a item 7: the vault in real Chrome, under the architecture CSP, with the production key
// derivation (600,000 iterations). Quota and blocked storage (N-28, N-32, N-33), two tabs (N-29),
// zero network and zero CSP violations during unlock, save and delete (N-08, N-34), and no service
// worker or cache holding anything (N-35). System Chrome through playwright-core; no download.
// Every value is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/vault-chrome.test.mjs

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { startVaultPageServer } from "./support/vault-page-server.mjs";

const PASSPHRASE = "lantern orbit pebble canyon";
const PAGE = "/vault-test.html";
const WEB = join(import.meta.dirname, "..");

let server;
let browser;

before(async () => {
  server = await startVaultPageServer();
  browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Open the test page in a context, recording every request and CSP violation from now on.
 *
 * @param {object} context A Playwright browser context.
 * @returns {Promise<{page: object, requests: object[]}>} The page and its request log.
 */
async function openTestPage(context) {
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.addInitScript(() => {
    globalThis.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => globalThis.cspViolations.push(event.effectiveDirective));
  });
  await page.goto(server.origin + PAGE);
  await page.evaluate(async () => {
    globalThis.vaultModule = await import("/persistence/vault.js");
  });
  return { page, requests };
}

/**
 * Random text that does not compress, `characters` long.
 *
 * @param {object} page The page to build it in.
 * @param {number} characters Length.
 * @returns {Promise<void>} Resolves when `globalThis.bulkyText` holds it.
 */
function makeBulkyText(page, characters) {
  return page.evaluate((length) => {
    let text = "";
    while (text.length < length) {
      text += Array.from(crypto.getRandomValues(new Uint8Array(60_000)), (byte) => byte.toString(36)).join("");
    }
    globalThis.bulkyText = text.slice(0, length);
  }, characters);
}

test("unlock, save, merge-style resave, lock and delete make zero requests and break no CSP rule (N-34)", async () => {
  const context = await browser.newContext();
  const { page, requests } = await openTestPage(context);
  const pageUrl = page.url();
  for (const request of requests) {
    assert.equal(new URL(request.url).origin, server.origin, request.url);
    assert.equal(request.method, "GET", request.url);
  }
  requests.length = 0;
  const outcome = await page.evaluate(async (passphrase) => {
    let persistRequests = 0;
    const realPersist = navigator.storage.persist.bind(navigator.storage);
    navigator.storage.persist = () => {
      persistRequests += 1;
      return realPersist();
    };
    const vault = await vaultModule.openVault();
    const before = persistRequests;
    await vault.create(passphrase, { hint: "the trip to the coast" });
    await vault.saveLedger("ledger-one", { transactions: [{ details: "Invented Shop", paid_out: 120 }] });
    vault.lock();
    const tab = await vaultModule.openVault();
    await tab.unlock(passphrase);
    const read = await tab.readLedger("ledger-one");
    await tab.saveLedger("ledger-one", { transactions: [...read.ledger.transactions, { details: "Invented Kiosk", paid_in: 500 }] });
    tab.lock();
    await tab.deleteAll();
    return { before, after: persistRequests, databases: (await indexedDB.databases()).length };
  }, PASSPHRASE);
  assert.deepEqual(requests, []);
  assert.deepEqual(await page.evaluate(() => globalThis.cspViolations), []);
  assert.deepEqual(outcome, { before: 0, after: 1, databases: 0 });
  assert.equal(page.url(), pageUrl, "the passphrase never reaches the URL");
  await context.close();
});

test("the production factory derives with at least 600,000 iterations in Chrome", async () => {
  const context = await browser.newContext();
  const { page } = await openTestPage(context);
  const iterations = await page.evaluate(async (passphrase) => {
    const vault = await vaultModule.openVault();
    await vault.create(passphrase);
    const database = await new Promise((resolve) => {
      const request = indexedDB.open(vaultModule.VAULT_DATABASE_NAME);
      request.onsuccess = () => resolve(request.result);
    });
    const meta = await new Promise((resolve) => {
      const request = database.transaction("meta").objectStore("meta").get("vault");
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return meta.kdf.iterations;
  }, PASSPHRASE);
  assert.ok(iterations >= 600_000, String(iterations));
  await context.close();
});

test("a real quota error gives the typed message and memory-only mode; the previous blob is intact (N-28, N-33)", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.overrideQuotaForOrigin", { origin: server.origin, quotaSize: 300_000 });
  await page.goto(server.origin + PAGE);
  await page.evaluate(async () => {
    globalThis.vaultModule = await import("/persistence/vault.js");
  });
  await makeBulkyText(page, 1_000_000);
  const outcome = await page.evaluate(async (passphrase) => {
    const vault = await vaultModule.openVault();
    await vault.create(passphrase);
    await vault.saveLedger("ledger-one", { transactions: [{ details: "Invented Shop" }] });
    let failure = null;
    try {
      await vault.saveLedger("ledger-one", { transactions: [{ details: globalThis.bulkyText }] });
    } catch (error) {
      failure = { code: error.code, message: error.message };
    }
    const afterwards = await vault.saveLedger("ledger-one", { transactions: [] });
    const fresh = await vaultModule.openVault();
    await fresh.unlock(passphrase);
    return { failure, status: vault.status(), afterwards, stored: await fresh.readLedger("ledger-one") };
  }, PASSPHRASE);
  assert.equal(outcome.failure.code, "STORAGE_QUOTA_EXCEEDED");
  assert.match(outcome.failure.message, /not enough storage space/);
  assert.equal(outcome.status.mode, "memory_only");
  assert.deepEqual(outcome.afterwards, { saved: false, reason: "MEMORY_ONLY" });
  assert.deepEqual(outcome.stored, { ledger: { transactions: [{ details: "Invented Shop" }] }, version: 1 });
  await context.close();
});

test("without the quota override the same large save succeeds: the failure above is the quota's", async () => {
  const context = await browser.newContext();
  const { page } = await openTestPage(context);
  await makeBulkyText(page, 1_000_000);
  const outcome = await page.evaluate(async (passphrase) => {
    const vault = await vaultModule.openVault();
    await vault.create(passphrase);
    return vault.saveLedger("ledger-one", { transactions: [{ details: globalThis.bulkyText }] });
  }, PASSPHRASE);
  assert.deepEqual(outcome, { saved: true, version: 1 });
  await context.close();
});

test("with site data blocked, the vault opens in memory-only mode and refuses to opt in with the typed message (N-32)", async () => {
  const profile = mkdtempSync(join(tmpdir(), "vault-blocked-profile-"));
  mkdirSync(join(profile, "Default"));
  writeFileSync(
    join(profile, "Default", "Preferences"),
    JSON.stringify({ profile: { default_content_setting_values: { cookies: 2 } } }),
  );
  const context = await chromium.launchPersistentContext(profile, { executablePath: chrome_path(), headless: true });
  try {
    const { page } = await openTestPage(context);
    const outcome = await page.evaluate(async (passphrase) => {
      const vault = await vaultModule.openVault();
      const status = vault.status();
      let refusal = null;
      try {
        await vault.create(passphrase);
      } catch (error) {
        refusal = { code: error.code, message: error.message };
      }
      return { status, refusal, save: await vault.saveLedger("ledger-one", { transactions: [] }) };
    }, PASSPHRASE);
    assert.equal(outcome.status.mode, "memory_only");
    assert.equal(outcome.status.storageProblem, "STORAGE_UNAVAILABLE");
    assert.equal(outcome.refusal.code, "STORAGE_UNAVAILABLE");
    assert.match(outcome.refusal.message, /still works/);
    assert.deepEqual(outcome.save, { saved: false, reason: "MEMORY_ONLY" });
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("two tabs: the stale tab cannot overwrite the newer save and is told to reload (N-29)", async () => {
  const context = await browser.newContext();
  const first = await openTestPage(context);
  await first.page.evaluate(async (passphrase) => {
    const vault = await vaultModule.openVault();
    await vault.create(passphrase);
    await vault.saveLedger("ledger-one", { transactions: [{ details: "Invented Shop" }] });
  }, PASSPHRASE);
  const second = await openTestPage(context);
  const openTab = async ({ page }) =>
    page.evaluate(async (passphrase) => {
      globalThis.tab = await vaultModule.openVault();
      await tab.unlock(passphrase);
      return (await tab.readLedger("ledger-one")).version;
    }, PASSPHRASE);
  assert.equal(await openTab(first), 1);
  assert.equal(await openTab(second), 1);
  const saved = await first.page.evaluate(() => tab.saveLedger("ledger-one", { transactions: [{ details: "Invented Kiosk" }] }));
  assert.deepEqual(saved, { saved: true, version: 2 });
  const stale = await second.page.evaluate(async () => {
    try {
      await tab.saveLedger("ledger-one", { transactions: [{ details: "Invented Market" }] });
      return null;
    } catch (error) {
      return { code: error.code, message: error.message };
    }
  });
  assert.equal(stale.code, "STALE_LEDGER");
  assert.match(stale.message, /Reload/);
  await second.page.reload();
  await second.page.evaluate(async () => {
    globalThis.vaultModule = await import("/persistence/vault.js");
  });
  assert.equal(await openTab(second), 2);
  assert.deepEqual(
    await second.page.evaluate(async () => (await tab.readLedger("ledger-one")).ledger),
    { transactions: [{ details: "Invented Kiosk" }] },
  );
  await context.close();
});

test("delete-all in one tab is not blocked by another open tab, which locks and clears (N-16)", async () => {
  const context = await browser.newContext();
  const first = await openTestPage(context);
  const second = await openTestPage(context);
  await first.page.evaluate(async (passphrase) => {
    globalThis.tab = await vaultModule.openVault();
    await tab.create(passphrase);
    await tab.saveLedger("ledger-one", { transactions: [{ details: "Invented Shop" }] });
  }, PASSPHRASE);
  await second.page.evaluate(async (passphrase) => {
    globalThis.tab = await vaultModule.openVault();
    await tab.unlock(passphrase);
    await tab.readLedger("ledger-one");
    globalThis.heard = [];
    tab.onLock((reason) => heard.push(reason));
  }, PASSPHRASE);
  const deleted = await first.page.evaluate(async () => {
    const timeout = new Promise((resolve) => setTimeout(() => resolve("blocked"), 10_000));
    return Promise.race([timeout, tab.deleteAll().then(async () => (await indexedDB.databases()).length)]);
  });
  assert.equal(deleted, 0);
  assert.deepEqual(
    await second.page.evaluate(() => ({ heard, locked: tab.status().locked, held: tab.status().heldLedgers })),
    { heard: ["elsewhere"], locked: true, held: 0 },
  );
  await context.close();
});

test("using the vault puts nothing in a cache, and the app's only service worker is its hand-written one (N-35)", async () => {
  const context = await browser.newContext();
  const { page } = await openTestPage(context);
  const held = await page.evaluate(async (passphrase) => {
    const vault = await vaultModule.openVault();
    await vault.create(passphrase);
    await vault.saveLedger("ledger-one", { transactions: [{ details: "Invented Shop" }] });
    return {
      workers: (await navigator.serviceWorker.getRegistrations()).length,
      caches: await caches.keys(),
    };
  }, PASSPHRASE);
  assert.deepEqual(held, { workers: 0, caches: [] });
  const sources = [join(WEB, "src")]
    .flatMap(function filesUnder(directory) {
      return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? filesUnder(path) : [path];
      });
    })
    .filter((path) => /\.(ts|tsx|js|mjs)$/.test(path));
  const registering = sources.filter((path) => /\.register\(\s*["']\/[^"']*\.js["']/.test(readFileSync(path, "utf8")));
  assert.deepEqual(registering, [join(WEB, "src/lib/service-worker.ts")], "one place registers a worker");
  assert.match(readFileSync(join(WEB, "src/lib/service-worker.ts"), "utf8"), /register\("\/sw\.js"/);
  assert.ok(existsSync(join(WEB, "public/sw.js")), "the worker is public/sw.js, whose caching tests/pwa-chrome.test.mjs checks");
  await context.close();
});
