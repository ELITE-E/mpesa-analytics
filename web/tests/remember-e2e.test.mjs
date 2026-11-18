// CP9c item 6: "Remember on this device" through the real UI in real Chrome, on synthetic PDFs: the
// static export with its CSP, the real engine and the production vault. Turn remembering on,
// import, reload, locked, a wrong passphrase (and the hint), unlock, the data and the saved
// quality card back; a second overlapping statement shows its merge counts; cancel saves nothing;
// a statement of another account becomes its own ledger; remove a statement; the idle lock; Lock;
// delete-all leaves no database. Throughout: only same-origin static GETs, no CSP violation, and
// no plaintext in the raw database. Every value is invented.
//
// Needs the runtime (tools/vendor.py runtime) and the app (npm run build in web/) built first.
// Run from web/:
//   node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/remember-e2e.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { app_pages, request_allowed } from "../../tools/browser/request_rule.js";
import { follow } from "../../tools/browser/ui_journey.js";
import { start_static_server } from "../scripts/serve_static.mjs";

const { claims, merge, rememberCard, settings, unlock, deleteAll } = await import("../src/content/remember.ts");
const { checks: checksCopy } = await import("../src/content/analysis-summary.ts");

const REPO = join(import.meta.dirname, "../..");
const FIXTURES = join(REPO, "tests/fixtures/synthetic");
const PASSPHRASE = "lantern orbit pebble canyon";
const WRONG = "violet harbour quartz meadow";
const HINT = "the trip to the coast";
const IMPORT_TIMEOUT_MS = 240_000;
const PROCEED = "Proceed to Analysis";
const PAGES = app_pages(join(import.meta.dirname, "../out"));
const GOLDEN_ROWS = JSON.parse(readFileSync(join(FIXTURES, "F-GOLDEN.expected.json"), "utf8")).row_count;

let server;
let browser;
let scratch;
let otherAccountPdf;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "remember-e2e-"));
  const generated = spawnSync(join(REPO, ".venv/bin/python"), ["tools/synth/generate.py", "--name", "F-OTHER-ACCOUNT", "--out-dir", scratch], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(generated.status, 0, "the generator wrote the other account's statement");
  otherAccountPdf = join(scratch, "F-OTHER-ACCOUNT.pdf");
});

before(async () => {
  server = await start_static_server();
  browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A fresh browser profile (context) on the app, recording every request and CSP violation.
 *
 * @param {object} [options] `clock`: install Playwright's fake clock before the app loads.
 * @returns {Promise<object>} The page, its records and a close function.
 */
async function openApp({ clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const records = { requests: [], cspConsole: 0 };
  context.on("request", (request) => records.requests.push({ url: request.url(), method: request.method(), hasBody: request.postData() !== null }));
  await context.addInitScript(() => {
    window.__cspViolations = 0;
    document.addEventListener("securitypolicyviolation", () => {
      window.__cspViolations += 1;
    });
  });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) records.cspConsole += 1;
  });
  return { page, records, close: () => context.close() };
}

/** Assert only same-origin static GETs (and prefetch HEADs to app pages) and no CSP violation. */
async function assertClean(app, where) {
  const broken = app.records.requests.filter((request) => !request_allowed(request, server.origin, PAGES));
  assert.deepEqual(broken.map((request) => `${request.method} ${request.url}`), [], `${where}: requests outside the rule`);
  assert.equal(await app.page.evaluate(() => window.__cspViolations ?? 0), 0, `${where}: CSP violations`);
  assert.equal(app.records.cspConsole, 0, `${where}: CSP console reports`);
}

/** Turn remembering on through the settings card: the profile's first page load. */
async function turnOn(page, { hint = HINT } = {}) {
  await page.goto(`${server.origin}/settings`);
  await page.getByRole("button", { name: rememberCard.turnOnLabel }).click();
  await page.getByLabel(rememberCard.passphraseLabel, { exact: false }).first().fill(PASSPHRASE);
  await page.getByLabel(rememberCard.confirmLabel).fill(PASSPHRASE);
  await page.getByLabel(rememberCard.hintLabel, { exact: false }).fill(hint);
  await page.getByRole("button", { name: rememberCard.submitLabel }).click();
  await page.getByText(rememberCard.turnedOn).waitFor();
}

/**
 * Read a statement on /upload and wait for the merge screen. The app's own link is followed: a
 * full page load would lock the vault, as it should.
 */
async function readToMerge(page, file) {
  await follow(page, "/upload");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: PROCEED }).click();
  await page.waitForURL(/\/merge/, { timeout: IMPORT_TIMEOUT_MS });
  await page.locator("[data-merge]").waitFor();
}

/** The merge screen's three counts. */
async function mergeCounts(page) {
  const count = async (name) => Number(await page.locator(`[data-count="${name}"]`).innerText());
  return { new: await count("new"), matched: await count("matched"), collided: await count("collided") };
}

/** Everything the vault's database holds, as text (binary as latin-1), read in the page. */
async function rawDatabaseText(page) {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((database) => database.name);
    const texts = [];
    for (const name of names) {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of database.objectStoreNames) {
        const values = await new Promise((resolve) => {
          const request = database.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
        });
        const decoder = new TextDecoder("latin1");
        texts.push(JSON.stringify(values, (_key, field) => (field instanceof Uint8Array ? decoder.decode(field) : field)));
      }
      database.close();
    }
    return texts.join("\n");
  });
}

/** The names of the databases this profile holds. */
function databaseNames(page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
}

test("remember, import, reload: locked; a wrong passphrase shows the hint; unlock brings the data back", { timeout: 30 * 60 * 1000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await turnOn(page);
    assert.equal(await page.locator("[data-lock-button]:visible").count(), 1, "the header offers Lock");

    await readToMerge(page, join(FIXTURES, "F-GOLDEN.pdf"));
    assert.ok((await page.locator("[data-merge]").innerText()).includes(claims.nothingWrittenUntilConfirmed));
    assert.deepEqual(await mergeCounts(page), { new: GOLDEN_ROWS, matched: 0, collided: 0 });
    await page.getByRole("button", { name: merge.confirmLabel, exact: true }).click();
    await page.locator("[data-merge-saved]").waitFor();
    assert.ok((await page.locator("[data-merge-saved]").innerText()).includes(merge.savedSummary(GOLDEN_ROWS, 0, 0)));
    assert.ok((await page.locator("[data-collision-count]").innerText()).includes(merge.collisionCount(0)));
    await page.getByRole("link", { name: merge.viewAnalysis }).click();
    await page.locator("[data-statement-checks]").waitFor({ timeout: 60_000 });
    const summaryUrl = page.url();

    await page.reload();
    await page.waitForURL(/\/unlock/, { timeout: 60_000 });
    await page.getByRole("heading", { name: unlock.title }).waitFor();
    assert.equal(await page.locator("[data-hint]").count(), 0, "no hint before a failed attempt");

    await page.getByLabel(unlock.passphraseLabel).fill(WRONG);
    await page.getByRole("button", { name: unlock.submitLabel, exact: true }).click();
    await page.getByText(unlock.wrongPassphrase).waitFor();
    assert.ok((await page.locator("[data-hint]").innerText()).includes(HINT));

    await page.getByLabel(unlock.passphraseLabel).fill(PASSPHRASE);
    await page.getByRole("button", { name: unlock.submitLabel, exact: true }).click();
    await page.waitForURL(/\/analysis-summary\?import=/, { timeout: 60_000 });
    assert.equal(new URL(page.url()).search, new URL(summaryUrl).search, "the saved statement is back");
    const checks = (await page.locator("[data-statement-checks]").innerText()).replace(/\s+/g, " ");
    assert.ok(checks.includes(checksCopy.chainHolds), "the saved quality card is back after reload");
    assert.ok(checks.includes(checksCopy.tokenNotKept), "the verification code was never stored");

    await follow(page, "/settings");
    await page.locator("[data-saved-statement]").first().waitFor();
    assert.equal(await page.locator("[data-saved-statement]").count(), 1);

    const raw = await rawDatabaseText(page);
    const golden = JSON.parse(readFileSync(join(FIXTURES, "F-GOLDEN.expected.json"), "utf8"));
    for (const needle of [golden.verification_token, "Example Person", "07000000", "example.invalid", "MERCHANT_PAYMENT", PASSPHRASE, "%PDF"]) {
      assert.equal(raw.includes(needle), false, `the raw database holds ${needle}`);
    }
    assert.ok(raw.includes(HINT), "the hint is stored unencrypted, as the card says");
    await assertClean(app, "remember, reload, unlock");
  } finally {
    await app.close();
  }
});

test("a second overlapping statement shows its counts; cancel saves nothing; another account opens its own ledger", { timeout: 30 * 60 * 1000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await turnOn(page, { hint: "" });
    await readToMerge(page, join(FIXTURES, "F-GOLDEN.pdf"));
    await page.getByRole("button", { name: merge.confirmLabel, exact: true }).click();
    await page.locator("[data-merge-saved]").waitFor();

    await readToMerge(page, join(FIXTURES, "F-GOLDEN.pdf"));
    assert.deepEqual(await mergeCounts(page), { new: 0, matched: GOLDEN_ROWS, collided: 0 });
    const before = await rawDatabaseText(page);
    await page.getByRole("button", { name: merge.cancelLabel }).click();
    await page.getByText(merge.cancelled).waitFor();
    assert.equal(await rawDatabaseText(page), before, "cancel wrote nothing");

    await readToMerge(page, join(FIXTURES, "F-GOLDEN.pdf"));
    await page.getByRole("button", { name: merge.confirmLabel, exact: true }).click();
    await page.locator("[data-merge-saved]").waitFor();
    assert.ok((await page.locator("[data-merge-saved]").innerText()).includes(merge.savedSummary(0, GOLDEN_ROWS, 0)));

    await readToMerge(page, otherAccountPdf);
    const card = await page.locator("[data-merge]").innerText();
    assert.ok(card.includes(merge.differentAccountTitle));
    assert.equal(/replace/i.test(card.replace(claims.noReplace, "")), false, "no replace offer");
    await page.getByRole("button", { name: merge.confirmSeparateLabel }).click();
    await page.locator("[data-merge-saved]").waitFor();

    await follow(page, "/settings");
    await page.locator("[data-ledger]").nth(1).waitFor();
    assert.equal(await page.locator("[data-ledger]").count(), 2, "two ledgers, one per account");
    assert.equal(await page.locator("[data-saved-statement]").count(), 1, "the other account's ledger is shown");
    await page.getByRole("button", { name: settings.switchLabel }).click();
    await page.locator("[data-saved-statement]").nth(1).waitFor();
    assert.equal(await page.locator("[data-saved-statement]").count(), 2, "the first account's two statements");

    await page.locator("[data-saved-statement]").first().getByRole("button", { name: settings.removeLabel }).click();
    await page.getByText(settings.removeQuestion).waitFor();
    await page.getByRole("button", { name: settings.removeConfirm }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-saved-statement]").length === 1);

    await page.locator("[data-lock-button]:visible").click();
    await page.waitForURL(/\/unlock/);
    await page.getByText(unlock.lockedNotice).waitFor();

    await page.getByRole("button", { name: unlock.forgotAction }).click();
    await page.getByText(deleteAll.confirmQuestion).waitFor();
    await page.getByRole("button", { name: deleteAll.confirmAction }).click();
    await page.waitForURL(/\/upload/);
    assert.deepEqual(await databaseNames(page), [], "delete-all leaves no database");
    await assertClean(app, "merge, separate ledger, remove, lock, delete-all");
  } finally {
    await app.close();
  }
});

test("after ten idle minutes the app locks itself and says so", { timeout: 10 * 60 * 1000 }, async () => {
  const app = await openApp({ clock: true });
  const { page } = app;
  try {
    await turnOn(page, { hint: "" });
    await page.locator("[data-lock-button]:visible").waitFor();
    await page.clock.fastForward("09:59");
    assert.equal(page.url().includes("/unlock"), false);
    await page.clock.fastForward("00:02");
    await page.waitForURL(/\/unlock/);
    await page.getByText(unlock.idleNotice).waitFor();
    await assertClean(app, "idle lock");
  } finally {
    await app.close();
  }
});

test("delete-all from settings asks first, then leaves the database empty", { timeout: 10 * 60 * 1000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await turnOn(page, { hint: "" });
    assert.deepEqual(await databaseNames(page), ["mpesa-analytics-vault"]);
    await page.getByRole("button", { name: deleteAll.action }).click();
    await page.getByText(deleteAll.confirmQuestion).waitFor();
    assert.deepEqual(await databaseNames(page), ["mpesa-analytics-vault"], "nothing deleted before the confirmation");
    await page.getByRole("button", { name: deleteAll.confirmAction }).click();
    await page.getByText(deleteAll.done).waitFor();
    assert.deepEqual(await databaseNames(page), []);
    await assertClean(app, "delete-all");
  } finally {
    await app.close();
  }
});
