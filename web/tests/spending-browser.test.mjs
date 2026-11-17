// The Spending area (IA migration Stage 7a) in a real browser: the principal
// headline (Q-D1) and airtime apart (Q-D2) from the import's rows, every door
// whose figure is printed on it opening a Ledger scope that adds up to that
// figure and links back, the receipt filters as keyboard-operable toggle
// buttons with visible focus, the accessibility tree's names and roles, and
// the empty, error and failed-rows states, which never pass for a
// zero-valued Spending. F5 and the stress statement lay out without overflow
// or clipped figures at 390, 768, 1024 and 1280 px.
//
// Real headless Chrome (support/cdp-browser.mjs) on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) serving F5, the stress statement and the
// no-spending statement with backend analytics (support/sample-api.mjs).
// Expected figures come from the fixtures' API fields; door totals are read
// off the Ledger each door opens.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts,
// the repository's .venv.
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/spending-browser.test.mjs

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launchBrowser } from "./support/cdp-browser.mjs";
import { apiError, json, startFakeApi } from "./support/fake-api.mjs";
import {
  buildForProduction,
  copyAppToTempDir,
  removeTempDir,
  startProductionServer,
} from "./support/frontend-server.mjs";
import { noSpendingFixture, prototypeSampleWithBackendAnalytics, SAMPLE_IMPORT_ID, sampleReadResponder, stressOverviewFixture } from "./support/sample-api.mjs";

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
];
const DESKTOP = VIEWPORTS[3];
const SLOW_STEP_MS = 120_000;
/** An import whose transactions fail (503) until `rowsRecovered`. */
const ROWS_DOWN_IMPORT_ID = 4;
const STRESS_IMPORT_ID = 5;
/** An import whose analytics fail (503). */
const ANALYTICS_DOWN_IMPORT_ID = 6;
const NO_SPENDING_IMPORT_ID = 7;
const SPENDING_TYPES = ["MERCHANT_PAYMENT", "BILL_PAYMENT", "BUNDLE_PURCHASE"];

let fixture;
let stress;
let none;
let api;
let appDir;
let web;
let browser;
/** Set to answer the import list with no imports. */
let noImports = false;
/** Set to let ROWS_DOWN_IMPORT_ID's transactions load. */
let rowsRecovered = false;

before(async () => {
  fixture = prototypeSampleWithBackendAnalytics();
  stress = stressOverviewFixture();
  none = noSpendingFixture();
  const sources = [[ROWS_DOWN_IMPORT_ID, fixture], [STRESS_IMPORT_ID, stress], [ANALYTICS_DOWN_IMPORT_ID, fixture], [NO_SPENDING_IMPORT_ID, none]];
  const otherAnswers = ({ method, path, query }) => {
    if (method !== "GET") return null;
    for (const [id, source] of sources) {
      const base = `/api/v1/imports/${id}`;
      if (path === base) return json(200, { ...source.summary, id });
      if (path === `${base}/analytics`) {
        return id === ANALYTICS_DOWN_IMPORT_ID ? apiError(503, "service_unavailable") : json(200, { ...source.snapshot, import_id: id });
      }
      if (path === `${base}/transactions`) {
        if (id === ROWS_DOWN_IMPORT_ID && !rowsRecovered) return apiError(503, "service_unavailable");
        const limit = Number(query.get("limit"));
        const offset = Number(query.get("offset"));
        return json(200, { items: source.rows.slice(offset, offset + limit), total: source.rows.length, limit, offset });
      }
    }
    return null;
  };
  const reads = sampleReadResponder(fixture, otherAnswers);
  api = await startFakeApi((request) => {
    if (noImports && request.method === "GET" && request.path === "/api/v1/imports") return json(200, { items: [] });
    return reads(request);
  });
  appDir = copyAppToTempDir();
  await buildForProduction(appDir, api.origin);
  web = await startProductionServer(appDir);
  browser = await launchBrowser();
}, { timeout: 600_000 });

after(async () => {
  await browser?.close();
  await web?.stop();
  removeTempDir(appDir);
  api?.close();
});

/** "KES 1,234.00", as the app formats money. */
function kes(amount) {
  return `KES ${new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

/** A signed-in tab at `viewport` showing `route`, once `ready` holds. */
async function openPage(viewport, route, ready = SPENDING_READY) {
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${web.origin}/login`);
  await page.evaluate(`sessionStorage.setItem("mpesa.session.token", "synthetic-token"); sessionStorage.setItem("mpesa.session.username", "spending-user"); true`);
  await page.goto(`${web.origin}${route}`);
  await page.waitFor(ready, `${route} to render`, SLOW_STEP_MS);
  return page;
}

/** Spending fully rendered: its receipts card (rows loaded) or an alert. */
const SPENDING_READY = `[...document.querySelectorAll("main h2")].some((h) => h.textContent === "Recent spending receipts") || !!document.querySelector('main [role="alert"]')`;

/** The visible text of `main`. */
function mainText(page) {
  return page.evaluate(`document.querySelector("main").innerText`);
}

/** Press a key with real keyboard events; `text` is what the key types (Enter types "\r", which activates a button). */
async function press(page, key, code, keyCode, text = undefined) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, text });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
}

describe("figures from the import (Q-D1, Q-D2)", () => {
  test("the principal headline, its answer, airtime under not counted, and one h1", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${SAMPLE_IMPORT_ID}`);
    try {
      const spending = fixture.rows.filter((row) => row.cash_flow_direction === "OUTFLOW" && SPENDING_TYPES.includes(row.event_type));
      const total = spending.reduce((sum, row) => sum + row.paid_out, 0);
      const airtime = fixture.rows.filter((row) => row.event_type === "AIRTIME_PURCHASE").reduce((sum, row) => sum + row.paid_out, 0);
      const shown = await mainText(page);
      assert.ok(shown.includes(kes(total)), `headline ${kes(total)}`);
      assert.ok(shown.includes(`${spending.length} payments for goods, bills and data`), shown.slice(0, 400));
      assert.match(shown, /Airtime\s+Bought for your line; not counted in Spending\s+KES/);
      assert.ok(shown.includes(kes(airtime)));
      assert.match(shown, /Charges linked to these payments: KES/);
      assert.equal(await page.evaluate(`[...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).length`), 1);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("every door's Ledger scope adds up to its figure, and Ledger links back", () => {
  test("headline, channels, not-counted buckets and merchants", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${SAMPLE_IMPORT_ID}`);
    try {
      const doors = await page.evaluate(`[...document.querySelectorAll('main a[href^="/ledger?scope="]')]
        .filter((a) => a.getBoundingClientRect().height > 0)
        .map((a) => ({ href: a.getAttribute("href"), amount: (a.textContent.match(/KES [0-9,]+\\.[0-9]{2}/) ?? [null])[0] }))
        .filter((door) => door.amount && !door.href.includes("scope=receipt"))`);
      const scopes = doors.map((door) => new URLSearchParams(door.href.split("?")[1]).get("scope"));
      assert.ok(scopes.includes("bucket:spending") && scopes.includes("bucket:airtime"), scopes.join(" | "));
      assert.ok(scopes.some((scope) => scope.startsWith("spending:")) && scopes.some((scope) => scope.startsWith("group:spending:")), scopes.join(" | "));
      for (const door of doors) {
        await page.goto(`${web.origin}${door.href}`);
        await page.waitFor(`!!document.querySelector("[data-scope-totals]")`, `the Ledger at ${door.href}`, SLOW_STEP_MS);
        const totals = await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`);
        assert.ok(totals.includes(`up to ${door.amount}`), `${door.href}: ${door.amount} vs ${totals}`);
        // The banner names the rows in words, never by the scope's id.
        const title = await page.evaluate(`document.querySelector("[data-scope-title]").textContent`);
        assert.doesNotMatch(title, /:|^(till|paybill|bundle)$/, `${door.href}: title "${title}"`);
      }
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("a real click on the headline opens its rows; Back returns to Spending on the import", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${SAMPLE_IMPORT_ID}`);
    try {
      await page.click('main header a[href*="scope=bucket%3Aspending"]');
      await page.waitFor(`location.pathname === "/ledger" && !!document.querySelector("[data-scope-totals]")`, "the Spending rows", SLOW_STEP_MS);
      await page.click('main a[href^="/breakdown/spending"]');
      await page.waitFor(`location.pathname === "/breakdown/spending"`, "back to Spending", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`location.search`), `?import=${SAMPLE_IMPORT_ID}`);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("accessibility", () => {
  test("receipt filters: toggle buttons in a named group, reached by Tab with visible focus, switched by Enter", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${SAMPLE_IMPORT_ID}`);
    try {
      await page.evaluate(`document.querySelector('[role="group"] button').focus(); true`);
      await press(page, "Tab", "Tab", 9);
      const focused = await page.evaluate(`(() => { const el = document.activeElement; return { pressed: el.getAttribute("aria-pressed"), inGroup: !!el.closest('[role="group"]'), outline: getComputedStyle(el).outlineStyle, text: el.textContent }; })()`);
      assert.deepEqual({ pressed: focused.pressed, inGroup: focused.inGroup }, { pressed: "false", inGroup: true });
      assert.notEqual(focused.outline, "none", "keyboard focus is visible");
      const before = await page.evaluate(`[...document.querySelectorAll('main a[href*="scope=receipt"]')].map((a) => a.getAttribute("href")).join()`);
      await press(page, "Enter", "Enter", 13, "\r");
      await page.waitFor(`document.activeElement.getAttribute("aria-pressed") === "true"`, "the filter pressed by Enter");
      const after = await page.evaluate(`[...document.querySelectorAll('main a[href*="scope=receipt"]')].map((a) => a.getAttribute("href")).join()`);
      assert.notEqual(after, before, `the preview follows the filter ${focused.text}`);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("the accessibility tree names the breadcrumb, the area switcher with Spending current, the filter group and its pressed buttons", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${SAMPLE_IMPORT_ID}`);
    try {
      await page.send("Accessibility.enable");
      const { nodes } = await page.send("Accessibility.getFullAXTree");
      const visible = nodes.filter((node) => !node.ignored).map((node) => ({ role: node.role?.value, name: String(node.name?.value ?? "").trim(), pressed: node.properties?.find((p) => p.name === "pressed")?.value?.value }));
      for (const name of ["Breadcrumb", "Breakdown areas"]) assert.ok(visible.some((n) => n.role === "navigation" && n.name === name), name);
      assert.ok(visible.some((n) => n.role === "group" && n.name === "Show receipts for"));
      assert.equal(visible.filter((n) => n.role === "button" && n.pressed !== undefined).length >= 2, true);
      const current = await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Breakdown areas"] [aria-current="page"]')].map((a) => a.getAttribute("href"))`);
      assert.deepEqual(current, [`/breakdown/spending?import=${SAMPLE_IMPORT_ID}`]);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("empty and error states are never a zero-valued Spending", () => {
  test("no spending: a real KES 0.00 said plainly; money out still accounted for, airtime included", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${NO_SPENDING_IMPORT_ID}`);
    try {
      const shown = await mainText(page);
      assert.match(shown, /No payments for goods, bills or data/);
      assert.match(shown, /No spending in this statement/);
      assert.ok(shown.includes(kes(none.snapshot.result.cash_flow.total_outflow)), "not counted totals money out");
      assert.match(shown, /Airtime/);
      assert.equal(await page.evaluate(`!!document.querySelector('main header a[href^="/ledger"]')`), false, "no door to an empty scope");
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("no imports: the no-statements card and no figures", async () => {
    noImports = true;
    try {
      const page = await openPage(DESKTOP, "/breakdown/spending", `document.querySelector("main").innerText.includes("No statements yet")`);
      try {
        assert.doesNotMatch(await mainText(page), /KES/);
      } finally {
        await page.close();
      }
    } finally {
      noImports = false;
    }
  }, { timeout: 300_000 });

  test("analytics fail: the retryable error card and no figure", async () => {
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${ANALYTICS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const shown = await mainText(page);
      assert.match(shown, /Try again/);
      assert.doesNotMatch(shown, /KES/);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("transactions fail (T-LOADFAIL): a retryable error, the API's recurring list stays, and Try again restores the area", async () => {
    rowsRecovered = false;
    const page = await openPage(DESKTOP, `/breakdown/spending?import=${ROWS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const failed = await mainText(page);
      assert.match(failed, /Recurring payments/);
      assert.doesNotMatch(failed, /What counts as spending|KES/);
      rowsRecovered = true;
      await page.click('main [role="alert"] button');
      await page.waitFor(`[...document.querySelectorAll("main h2")].some((h) => h.textContent === "What counts as spending")`, "the area after Try again", SLOW_STEP_MS);
    } finally {
      rowsRecovered = false;
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("layout at four widths", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["stress", STRESS_IMPORT_ID]]) {
    for (const viewport of VIEWPORTS) {
      test(`${label} at ${viewport.name}: no overflow, no clipped figure`, async () => {
        const page = await openPage(viewport, `/breakdown/spending?import=${id}`);
        try {
          const layout = await page.evaluate(`(() => ({
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            clipped: [...document.querySelectorAll("main .tabular-nums")]
              .filter((el) => el.getBoundingClientRect().height > 0)
              .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > innerWidth + 1)
              .map((el) => el.textContent.trim()),
          }))()`);
          assert.deepEqual(layout, { pageOverflow: false, clipped: [] });
          assert.deepEqual(page.exceptions, []);
        } finally {
          await page.close();
        }
      }, { timeout: 300_000 });
    }
  }
});
