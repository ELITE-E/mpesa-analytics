// The Cash area (IA migration Stage 7e) in a real browser: the cash
// withdrawn from the import's rows (the API has no withdrawal total), agents
// by their exact stored name (an unidentified agent is "Not identified"; a
// cash deposit at an agent stays out of its door), the linked charges, every
// door whose figure is printed on it opening a Ledger scope that adds up to
// that figure, titled in words and linking back; the headline door named for
// screen readers, agent doors reachable by keyboard with visible focus; and
// the empty, error and failed-rows states, which never pass for a zero-valued
// Cash. F5 and the Cash edge cases lay out without overflow or clipped
// figures at 390, 768, 1024 and 1280 px.
//
// Real headless Chrome (support/cdp-browser.mjs) on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) serving F5 and the Cash edge cases with
// backend analytics, and F4 (no withdrawals) (support/sample-api.mjs,
// support/contract-fixtures.mjs). Expected figures come from the fixtures;
// door totals are read off the Ledger each door opens.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts,
// the repository's .venv.
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/cash-browser.test.mjs

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launchBrowser } from "./support/cdp-browser.mjs";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { apiError, json, startFakeApi } from "./support/fake-api.mjs";
import {
  buildForProduction,
  copyAppToTempDir,
  removeTempDir,
  startProductionServer,
} from "./support/frontend-server.mjs";
import { cashEdgeCasesFixture, prototypeSampleWithBackendAnalytics, SAMPLE_IMPORT_ID, sampleReadResponder } from "./support/sample-api.mjs";

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
const EDGE_IMPORT_ID = 5;
/** An import whose analytics fail (503). */
const ANALYTICS_DOWN_IMPORT_ID = 6;
/** F4: no withdrawals. */
const NO_WITHDRAWALS_IMPORT_ID = 7;

let fixture;
let edge;
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
  edge = cashEdgeCasesFixture();
  const noWithdrawals = contractFixtures()["F4-paginated-2345"];
  const sources = [[ROWS_DOWN_IMPORT_ID, fixture], [EDGE_IMPORT_ID, edge], [ANALYTICS_DOWN_IMPORT_ID, fixture], [NO_WITHDRAWALS_IMPORT_ID, noWithdrawals]];
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

/** Cash fully rendered: its agents card (rows loaded) or an alert. */
const CASH_READY = `[...document.querySelectorAll("main h2")].some((h) => h.textContent === "Agents used") || !!document.querySelector('main [role="alert"]')`;

/** A signed-in tab at `viewport` showing `route`, once `ready` holds. */
async function openPage(viewport, route, ready = CASH_READY) {
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${web.origin}/login`);
  await page.evaluate(`sessionStorage.setItem("mpesa.session.token", "synthetic-token"); sessionStorage.setItem("mpesa.session.username", "cash-user"); true`);
  await page.goto(`${web.origin}${route}`);
  await page.waitFor(ready, `${route} to render`, SLOW_STEP_MS);
  return page;
}

/** The visible text of `main`. */
function mainText(page) {
  return page.evaluate(`document.querySelector("main").innerText`);
}

/** Press a key with real keyboard events. */
async function press(page, key, code, keyCode) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
}

describe("figures from the import", () => {
  test("the withdrawals answer the question; agents, charges and notes; a deposit at an agent isn't cash withdrawn; one h1", async () => {
    const page = await openPage(DESKTOP, `/breakdown/cash?import=${EDGE_IMPORT_ID}`);
    try {
      const shown = await mainText(page);
      assert.ok(shown.includes(kes(13000)), shown.slice(0, 500));
      assert.ok(shown.includes(`4 withdrawals at 2 agents. Withdrawing carried ${kes(163)} in charges, 1.3% of the cash you took out.`), shown.slice(0, 600));
      assert.ok(shown.includes(kes(10000)), "Juja Rd Agencies: withdrawals only");
      assert.match(shown, /Not identified/);
      assert.match(shown, /Where the cash went isn't on the statement/i);
      assert.match(shown, /part of Money In/);
      assert.equal(await page.evaluate(`[...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).length`), 1);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("every door's Ledger scope adds up to its figure, is titled in words, and links back", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["edge cases", EDGE_IMPORT_ID]]) {
    test(`${label}: header, agents and withdrawals`, async () => {
      const page = await openPage(DESKTOP, `/breakdown/cash?import=${id}`);
      try {
        const doors = await page.evaluate(`[...document.querySelectorAll('main a[href^="/ledger?scope="]')]
          .filter((a) => a.getBoundingClientRect().height > 0)
          .map((a) => ({ href: a.getAttribute("href"), amount: (a.textContent.match(/KES [0-9,]+\\.[0-9]{2}/) ?? [null])[0] }))
          .filter((door) => door.amount)`);
        const scopes = doors.map((door) => new URLSearchParams(door.href.split("?")[1]).get("scope"));
        assert.ok(scopes.includes("bucket:cash-withdrawn"), scopes.join(" | "));
        assert.ok(scopes.some((scope) => scope.startsWith("group:cash-withdrawn:")) && scopes.some((scope) => scope.startsWith("receipt:")), scopes.join(" | "));
        for (const door of doors) {
          await page.goto(`${web.origin}${door.href}`);
          const scope = new URLSearchParams(door.href.split("?")[1]).get("scope");
          if (scope.startsWith("receipt:")) {
            // A receipt scope has no totals banner (scope-banner.tsx): its title names the receipt and its row shows the amount.
            await page.waitFor(`!!document.querySelector("[data-scope-title]") && document.querySelector("main").innerText.includes(${JSON.stringify(door.amount)})`, `the receipt at ${door.href}`, SLOW_STEP_MS);
            assert.ok((await page.evaluate(`document.querySelector("[data-scope-title]").textContent`)).includes(scope.slice("receipt:".length)), door.href);
            continue;
          }
          await page.waitFor(`!!document.querySelector("[data-scope-totals]")`, `the Ledger at ${door.href}`, SLOW_STEP_MS);
          const totals = await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`);
          assert.ok(totals.includes(`up to ${door.amount}`), `${door.href}: ${door.amount} vs ${totals}`);
          const title = await page.evaluate(`document.querySelector("[data-scope-title]").textContent`);
          assert.doesNotMatch(title, /NO_ENTITY|cash-withdrawn|group:|bucket:/, `${door.href}: title "${title}"`);
          const back = await page.evaluate(`[...document.querySelectorAll('main a[href^="/breakdown/cash"]')].map((a) => a.getAttribute("href"))`);
          assert.ok(back.includes(`/breakdown/cash?import=${id}`), `${door.href}: back link ${back.join(" | ")}`);
        }
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });
  }

  test("a real click on an agent opens its withdrawals, not its deposit; Back returns to Cash on the import", async () => {
    const page = await openPage(DESKTOP, `/breakdown/cash?import=${EDGE_IMPORT_ID}`);
    try {
      await page.click('main a[href*="scope=group%3Acash-withdrawn%3AJuja+Rd+Agencies&"]');
      await page.waitFor(`location.pathname === "/ledger" && !!document.querySelector("[data-scope-totals]")`, "Juja Rd Agencies' withdrawals", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`document.querySelector("[data-scope-title]").textContent`), "Juja Rd Agencies");
      assert.match(await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`), /2 rows.*up to KES 10,000\.00/);
      await page.click('main a[href^="/breakdown/cash"]');
      await page.waitFor(`location.pathname === "/breakdown/cash"`, "back to Cash", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`location.search`), `?import=${EDGE_IMPORT_ID}`);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("accessibility", () => {
  test("the headline door is named; headings are semantic; Tab reaches agent doors with visible focus; Cash is the current area", async () => {
    const page = await openPage(DESKTOP, `/breakdown/cash?import=${EDGE_IMPORT_ID}`);
    try {
      await page.send("Accessibility.enable");
      const { nodes } = await page.send("Accessibility.getFullAXTree");
      const names = nodes.filter((node) => !node.ignored && node.role?.value === "link").map((node) => String(node.name?.value ?? ""));
      assert.ok(names.includes("See the 4 withdrawals behind KES 13,000.00"), names.join(" | "));
      const headings = nodes.filter((node) => !node.ignored && node.role?.value === "heading").map((node) => String(node.name?.value ?? ""));
      for (const heading of ["What happened with cash withdrawals?", "Agents used", "Largest withdrawals", "What withdrawing cost"]) assert.ok(headings.includes(heading), heading);
      await page.evaluate(`document.querySelector('main a[href*="scope=bucket%3Acash-withdrawn"]').focus(); true`);
      let reached = null;
      for (let step = 0; step < 15 && !reached; step += 1) {
        await press(page, "Tab", "Tab", 9);
        reached = await page.evaluate(`(() => { const el = document.activeElement; return el.getAttribute("href")?.includes("group%3Acash-withdrawn") ? { outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow } : null; })()`);
      }
      assert.ok(reached, "Tab reaches an agent door");
      assert.ok(reached.outline !== "none" || reached.shadow !== "none", `keyboard focus is visible: ${JSON.stringify(reached)}`);
      const current = await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Breakdown areas"] [aria-current="page"]')].map((a) => a.getAttribute("href"))`);
      assert.deepEqual(current, [`/breakdown/cash?import=${EDGE_IMPORT_ID}`]);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("empty and error states are never a zero-valued Cash", () => {
  test("no withdrawals: said plainly over a real KES 0.00, with no door", async () => {
    const page = await openPage(DESKTOP, `/breakdown/cash?import=${NO_WITHDRAWALS_IMPORT_ID}`);
    try {
      assert.match(await mainText(page), /You didn't withdraw any cash in this statement/);
      assert.equal(await page.evaluate(`!!document.querySelector('main a[href^="/ledger"]')`), false);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("no imports: the no-statements card and no figures", async () => {
    noImports = true;
    try {
      const page = await openPage(DESKTOP, "/breakdown/cash", `document.querySelector("main").innerText.includes("No statements yet")`);
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
    const page = await openPage(DESKTOP, `/breakdown/cash?import=${ANALYTICS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const shown = await mainText(page);
      assert.match(shown, /Try again/);
      assert.doesNotMatch(shown, /KES/);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("transactions fail (T-LOADFAIL): no Cash figure at all (the API has none), a retryable error until Try again succeeds", async () => {
    rowsRecovered = false;
    const page = await openPage(DESKTOP, `/breakdown/cash?import=${ROWS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const failed = await mainText(page);
      assert.doesNotMatch(failed, /KES/, "no figure without the rows");
      assert.doesNotMatch(failed, /Agents used/);
      assert.equal(await page.evaluate(`!!document.querySelector('main a[href^="/ledger"]')`), false, "no door while the rows are missing");
      rowsRecovered = true;
      await page.click('main [role="alert"] button');
      await page.waitFor(`[...document.querySelectorAll("main h2")].some((h) => h.textContent === "Agents used")`, "the agents after Try again", SLOW_STEP_MS);
    } finally {
      rowsRecovered = false;
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("layout at four widths", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["edge cases", EDGE_IMPORT_ID]]) {
    for (const viewport of VIEWPORTS) {
      test(`${label} at ${viewport.name}: no overflow, no clipped figure`, async () => {
        const page = await openPage(viewport, `/breakdown/cash?import=${id}`);
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
