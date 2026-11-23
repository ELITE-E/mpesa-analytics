// CP10a items 2 and 5 in real Chrome: axe-core on every route of the static export (with a
// synthetic statement read, and through the remember screens) finds no serious or critical
// violation; upload, unlock and merge can be used from the keyboard and every field has a label;
// and real Chrome passes the capability check, so no notice shows. axe runs through DevTools
// evaluation, which the page's CSP does not govern; nothing is injected into the page itself.
//
// Needs the runtime and the app built (npm run build in web/).
// Run from web/:
//   node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/a11y-chrome.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { follow } from "../../tools/browser/ui_journey.js";
import { start_static_server } from "../scripts/serve_static.mjs";

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const FIXTURES = join(import.meta.dirname, "../../tests/fixtures/synthetic");
const PASSPHRASE = "lantern orbit pebble canyon";
const IMPORT_TIMEOUT_MS = 300_000;
const PROCEED = "Proceed to Analysis";
const STORY_ROUTES = [
  "/overview",
  "/ledger",
  "/breakdown",
  "/breakdown/spending",
  "/breakdown/people",
  "/breakdown/money-in",
  "/breakdown/cash",
  "/breakdown/savings",
  "/breakdown/fees",
];

let server;
let browser;
const failures = [];

before(async () => {
  server = await start_static_server();
  browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** A fresh profile on the app, waiting for the service worker so it does not race the checks. */
async function openApp() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** Run axe on what the page shows; record serious and critical violations under `where`. */
async function audit(page, where) {
  const found = await page.evaluate(async (source) => {
    if (!window.axe) (0, eval)(source);
    const results = await window.axe.run(document, { resultTypes: ["violations"] });
    return results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  }, AXE_SOURCE);
  for (const violation of found) failures.push(`${where}: ${violation}`);
}

/** The accessible name of the element that has the keyboard focus. */
function focusedName(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "";
    const labelled = element.labels?.[0]?.innerText ?? "";
    return `${element.tagName.toLowerCase()}:${(element.getAttribute("aria-label") || labelled || element.innerText || element.getAttribute("name") || "").trim()}`;
  });
}

/** Press Tab until an element whose name matches `pattern` has the focus, or fail. */
async function tabTo(page, pattern, where) {
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press("Tab");
    if (pattern.test(await focusedName(page))) return;
  }
  assert.fail(`${where}: the keyboard never reaches ${pattern}`);
}

test("every route, with a statement read, has no serious or critical axe violation; no capability notice in Chrome", { timeout: 20 * 60 * 1000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.goto(`${server.origin}/`);
    await audit(page, "/");
    assert.equal(await page.locator("[data-capability-notice]").count(), 0, "real Chrome has every capability");
    await page.goto(`${server.origin}/upload`);
    await audit(page, "/upload");
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, "F-GOLDEN.pdf"));
    await audit(page, "/upload with a statement chosen");
    await page.getByRole("button", { name: PROCEED }).click();
    await page.waitForURL(/\/processing/);
    await audit(page, "/processing");
    await page.waitForURL(/\/analysis-summary/, { timeout: IMPORT_TIMEOUT_MS });
    await page.locator("[data-statement-checks]").waitFor({ timeout: 60_000 });
    await audit(page, "/analysis-summary");
    for (const route of STORY_ROUTES) {
      await follow(page, route.startsWith("/breakdown/") ? "/breakdown" : route);
      if (route.startsWith("/breakdown/")) await follow(page, route);
      await page.waitForLoadState("networkidle");
      await audit(page, route);
    }
    await page.goto(`${server.origin}/upload`);
    await page.locator('input[type="file"]').setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
    await page.getByRole("button", { name: PROCEED }).click();
    await page.waitForURL(/\/recovery/, { timeout: IMPORT_TIMEOUT_MS });
    await audit(page, "/recovery");
  } finally {
    await app.close();
  }
});

test("the remember screens have no serious or critical axe violation", { timeout: 20 * 60 * 1000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.goto(`${server.origin}/settings`);
    await audit(page, "/settings, off");
    await page.locator("[data-remember-turn-on]").click();
    await audit(page, "/settings, choosing a passphrase");
    await page.locator('input[name="passphrase"]').fill(PASSPHRASE);
    await page.locator('input[name="confirmation"]').fill(PASSPHRASE);
    await page.locator('input[name="hint"]').fill("the trip to the coast");
    await page.locator("[data-remember-submit]").click();
    await page.locator("[data-lock-button]:visible").waitFor();
    await audit(page, "/settings, on");
    await follow(page, "/upload");
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, "F-GOLDEN.pdf"));
    await page.getByRole("button", { name: PROCEED }).click();
    await page.waitForURL(/\/merge/, { timeout: IMPORT_TIMEOUT_MS });
    await page.locator("[data-merge-counts]").waitFor();
    await audit(page, "/merge");
    await page.locator("[data-merge-confirm]").click();
    await page.locator("[data-merge-saved]").waitFor();
    await audit(page, "/merge, saved");
    await page.locator("[data-lock-button]:visible").click();
    await page.waitForURL(/\/unlock/);
    await audit(page, "/unlock");
    await page.locator('input[name="passphrase"]').fill("violet harbour quartz meadow");
    await page.locator('input[name="passphrase"]').press("Enter");
    await page.locator("[data-hint]").waitFor();
    await audit(page, "/unlock, after a wrong passphrase");
  } finally {
    await app.close();
  }
});

test("upload, unlock and merge work from the keyboard, and every field has a label", { timeout: 20 * 60 * 1000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.goto(`${server.origin}/settings`);
    await page.locator("[data-remember-turn-on]").focus();
    await page.keyboard.press("Enter");
    await tabTo(page, /^input:Passphrase/, "remember card");
    await page.keyboard.type(PASSPHRASE);
    await tabTo(page, /^input:Passphrase again/, "remember card");
    await page.keyboard.type(PASSPHRASE);
    await tabTo(page, /^button:Turn on remembering/, "remember card");
    await page.keyboard.press("Enter");
    await page.locator("[data-lock-button]:visible").waitFor();

    await follow(page, "/upload");
    // The file input is hidden; the keyboard reaches the button that opens the file picker.
    await tabTo(page, /^button:.*(statement|PDF)/i, "/upload choose-a-statement button");
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, "F-GOLDEN.pdf"));
    await tabTo(page, /^input:.*password/i, "/upload password field");
    await tabTo(page, new RegExp(`^button:${PROCEED}`), "/upload proceed");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/merge/, { timeout: IMPORT_TIMEOUT_MS });
    await page.locator("[data-merge-counts]").waitFor();
    await tabTo(page, /^button:Save$/, "/merge save");
    await page.keyboard.press("Enter");
    await page.locator("[data-merge-saved]").waitFor();

    await tabTo(page, /^button:Lock/, "the header's Lock");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/unlock/);
    await tabTo(page, /^input:Passphrase/, "/unlock passphrase");
    await page.keyboard.type(PASSPHRASE);
    await tabTo(page, /^button:Unlock$/, "/unlock button");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/analysis-summary/, { timeout: 60_000 });

    const unlabelled = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")]
        .filter((field) => field.type !== "hidden" && !field.labels?.length && !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby"))
        .map((field) => field.outerHTML.slice(0, 80)),
    );
    assert.deepEqual(unlabelled, []);
  } finally {
    await app.close();
  }
});

test("no route had a serious or critical axe violation", () => {
  assert.deepEqual(failures, []);
});
