// The People area (IA migration Stage 7b) in a real browser: sent and
// received from the import, people grouped by their exact stored name (two
// spellings stay two people; an unidentified recipient is "Not identified"),
// every door whose figure is printed on it opening a Ledger scope that adds
// up to that figure, titled in words and linking back; person doors named for
// screen readers and reachable by keyboard with visible focus; and the empty,
// error and failed-rows states, which never pass for a zero-valued People.
// F5 and the People edge cases lay out without overflow or clipped figures
// at 390, 768, 1024 and 1280 px.
//
// Real headless Chrome (support/cdp-browser.mjs) on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) serving F5 and the People edge cases with
// backend analytics, and F4 (no transfers) (support/sample-api.mjs,
// support/contract-fixtures.mjs). Expected figures come from the fixtures'
// API fields; door totals are read off the Ledger each door opens.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts,
// the repository's .venv.
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/people-browser.test.mjs

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
import { peopleEdgeCasesFixture, prototypeSampleWithBackendAnalytics, SAMPLE_IMPORT_ID, sampleReadResponder } from "./support/sample-api.mjs";

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
/** F4: no transfers at all. */
const NO_TRANSFERS_IMPORT_ID = 7;

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
  edge = peopleEdgeCasesFixture();
  const noTransfers = contractFixtures()["F4-paginated-2345"];
  const sources = [[ROWS_DOWN_IMPORT_ID, fixture], [EDGE_IMPORT_ID, edge], [ANALYTICS_DOWN_IMPORT_ID, fixture], [NO_TRANSFERS_IMPORT_ID, noTransfers]];
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

/** People fully rendered: its people list (rows loaded), the empty list, or an alert. */
const PEOPLE_READY = `[...document.querySelectorAll("main h2")].some((h) => h.textContent === "Who you exchanged money with") || !!document.querySelector('main [role="alert"]')`;

/** A signed-in tab at `viewport` showing `route`, once `ready` holds. */
async function openPage(viewport, route, ready = PEOPLE_READY) {
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${web.origin}/login`);
  await page.evaluate(`sessionStorage.setItem("mpesa.session.token", "synthetic-token"); sessionStorage.setItem("mpesa.session.username", "people-user"); true`);
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
  test("the API's sent and received answer the question; two spellings stay two people; one h1", async () => {
    const page = await openPage(DESKTOP, `/breakdown/people?import=${EDGE_IMPORT_ID}`);
    try {
      const transfers = edge.snapshot.result.transfers;
      const shown = await mainText(page);
      assert.ok(shown.includes(`You sent ${kes(transfers.total_transfers.total_transfer_amount)} to 3 people and received ${kes(transfers.total_received.total_received)} from 2.`), shown.slice(0, 500));
      assert.ok(shown.includes("Mary Wanjiku") && shown.includes("MARY WANJIKU"));
      assert.match(shown, /Not identified/);
      assert.match(shown, /NOT AVAILABLE YET/i);
      assert.equal(await page.evaluate(`[...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).length`), 1);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("every door's Ledger scope adds up to its figure, is titled in words, and links back", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["edge cases", EDGE_IMPORT_ID]]) {
    test(`${label}: header, directions, each person's sent and received`, async () => {
      const page = await openPage(DESKTOP, `/breakdown/people?import=${id}`);
      try {
        const doors = await page.evaluate(`[...document.querySelectorAll('main a[href^="/ledger?scope="]')]
          .filter((a) => a.getBoundingClientRect().height > 0)
          .map((a) => ({ href: a.getAttribute("href"), amount: (a.textContent.match(/KES [0-9,]+\\.[0-9]{2}/) ?? [null])[0] }))
          .filter((door) => door.amount && !door.href.includes("scope=receipt"))`);
        const scopes = doors.map((door) => new URLSearchParams(door.href.split("?")[1]).get("scope"));
        assert.ok(scopes.includes("bucket:sent-to-people") && scopes.includes("bucket:from-people"), scopes.join(" | "));
        assert.ok(scopes.some((scope) => scope.startsWith("group:sent-to-people:")) && scopes.some((scope) => scope.startsWith("group:from-people:")), scopes.join(" | "));
        for (const door of doors) {
          await page.goto(`${web.origin}${door.href}`);
          await page.waitFor(`!!document.querySelector("[data-scope-totals]")`, `the Ledger at ${door.href}`, SLOW_STEP_MS);
          const totals = await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`);
          assert.ok(totals.includes(`up to ${door.amount}`), `${door.href}: ${door.amount} vs ${totals}`);
          const title = await page.evaluate(`document.querySelector("[data-scope-title]").textContent`);
          assert.doesNotMatch(title, /:|NO_ENTITY|sent-to-people|from-people/, `${door.href}: title "${title}"`);
        }
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });
  }

  test("a real click on a person's sent amount opens their sends; Back returns to People on the import", async () => {
    const page = await openPage(DESKTOP, `/breakdown/people?import=${EDGE_IMPORT_ID}`);
    try {
      await page.click('main a[aria-label^="Sent to MARY WANJIKU"]');
      await page.waitFor(`location.pathname === "/ledger" && !!document.querySelector("[data-scope-totals]")`, "MARY WANJIKU's sends", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`document.querySelector("[data-scope-title]").textContent`), "MARY WANJIKU");
      assert.match(await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`), /1 row.*up to KES 1,500\.00/);
      await page.click('main a[href^="/breakdown/people"]');
      await page.waitFor(`location.pathname === "/breakdown/people"`, "back to People", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`location.search`), `?import=${EDGE_IMPORT_ID}`);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("accessibility", () => {
  test("person doors have names saying direction, person and amount; Tab reaches them with visible focus; People is the current area", async () => {
    const page = await openPage(DESKTOP, `/breakdown/people?import=${EDGE_IMPORT_ID}`);
    try {
      await page.send("Accessibility.enable");
      const { nodes } = await page.send("Accessibility.getFullAXTree");
      const names = nodes.filter((node) => !node.ignored && node.role?.value === "link").map((node) => String(node.name?.value ?? ""));
      assert.ok(names.includes("Sent to MARY WANJIKU: KES 1,500.00, see the rows"), names.join(" | "));
      assert.ok(names.includes("Received from Mary Wanjiku: KES 5,000.00, see the rows"));
      assert.ok(names.includes("Sent to Not identified: KES 700.00, see the rows"));
      await page.evaluate(`document.querySelector('main a[aria-label^="Sent to"]').focus(); true`);
      await press(page, "Tab", "Tab", 9);
      const focused = await page.evaluate(`(() => { const el = document.activeElement; return { label: el.getAttribute("aria-label"), outline: getComputedStyle(el).outlineStyle }; })()`);
      assert.match(focused.label ?? "", /^(Sent to|Received from) /);
      assert.notEqual(focused.outline, "none", "keyboard focus is visible");
      const current = await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Breakdown areas"] [aria-current="page"]')].map((a) => a.getAttribute("href"))`);
      assert.deepEqual(current, [`/breakdown/people?import=${EDGE_IMPORT_ID}`]);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("empty and error states are never a zero-valued People", () => {
  test("no transfers: said plainly over a real KES 0.00, with no door", async () => {
    const page = await openPage(DESKTOP, `/breakdown/people?import=${NO_TRANSFERS_IMPORT_ID}`);
    try {
      assert.match(await mainText(page), /No money moved between you and other people/);
      assert.equal(await page.evaluate(`!!document.querySelector('main a[href^="/ledger"]')`), false);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("no imports: the no-statements card and no figures", async () => {
    noImports = true;
    try {
      const page = await openPage(DESKTOP, "/breakdown/people", `document.querySelector("main").innerText.includes("No statements yet")`);
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
    const page = await openPage(DESKTOP, `/breakdown/people?import=${ANALYTICS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const shown = await mainText(page);
      assert.match(shown, /Try again/);
      assert.doesNotMatch(shown, /KES/);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("transactions fail (T-LOADFAIL): the API's totals stay, the people give way to a retryable error until Try again succeeds", async () => {
    rowsRecovered = false;
    const page = await openPage(DESKTOP, `/breakdown/people?import=${ROWS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const failed = await mainText(page);
      assert.ok(failed.includes(kes(fixture.snapshot.result.transfers.total_transfers.total_transfer_amount)), "the API's sent total stays");
      assert.doesNotMatch(failed, /Who you exchanged money with/);
      assert.equal(await page.evaluate(`!!document.querySelector('main a[href^="/ledger"]')`), false, "no door while the rows are missing");
      rowsRecovered = true;
      await page.click('main [role="alert"] button');
      await page.waitFor(`[...document.querySelectorAll("main h2")].some((h) => h.textContent === "Who you exchanged money with")`, "the people after Try again", SLOW_STEP_MS);
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
        const page = await openPage(viewport, `/breakdown/people?import=${id}`);
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
