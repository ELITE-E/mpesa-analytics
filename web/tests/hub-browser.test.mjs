// The Breakdown hub (IA migration Stage 8a) in a real browser: money out and
// in answering the question, each area's figure and share, and "How the
// parts add up" listing every outflow bucket with money (F1's unsupported
// Not yet classified, Airtime and Reversals included) back to money out;
// every door whose figure is printed on it opening a Ledger scope that adds
// up to that figure, titled in words and linking back to the hub; the areas
// openable in every state; doors reachable by keyboard with visible focus;
// and the empty, error and failed-rows states, which never pass for a
// zero-valued hub. F5 and F1 lay out without overflow or clipped figures at
// 390, 768, 1024 and 1280 px.
//
// Real headless Chrome (support/cdp-browser.mjs) on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) serving F5 with backend analytics, F1 and F4
// (support/sample-api.mjs, support/contract-fixtures.mjs). Door totals are
// read off the Ledger each door opens.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts,
// the repository's .venv.
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/hub-browser.test.mjs

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
import { prototypeSampleWithBackendAnalytics, SAMPLE_IMPORT_ID, sampleReadResponder } from "./support/sample-api.mjs";

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
/** F4: a statement with spending and one deposit only. */
const F4_IMPORT_ID = 7;

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
  edge = contractFixtures()["F1-worked-example"];
  const f4 = contractFixtures()["F4-paginated-2345"];
  const sources = [[ROWS_DOWN_IMPORT_ID, fixture], [EDGE_IMPORT_ID, edge], [ANALYTICS_DOWN_IMPORT_ID, fixture], [F4_IMPORT_ID, f4]];
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

/** The hub fully rendered: its "adds up" card (rows loaded) or an alert. */
const HUB_READY = `[...document.querySelectorAll("main h2")].some((h) => h.textContent === "How the parts add up") || !!document.querySelector('main [role="alert"]')`;

/** A signed-in tab at `viewport` showing `route`, once `ready` holds. */
async function openPage(viewport, route, ready = HUB_READY) {
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${web.origin}/login`);
  await page.evaluate(`sessionStorage.setItem("mpesa.session.token", "synthetic-token"); sessionStorage.setItem("mpesa.session.username", "hub-user"); true`);
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
  test("money out and in answer the question; every area has its figure; F1's unsupported buckets are listed and add up; one h1", async () => {
    const page = await openPage(DESKTOP, `/breakdown?import=${EDGE_IMPORT_ID}`);
    try {
      const flow = edge.snapshot.result.cash_flow;
      const shown = await mainText(page);
      // Icon ligatures (e.g. a door's "receipt_long") are in innerText; read the sentence without them.
      const sentence = shown.replace(/\s*receipt_long\s*/g, " ").replace(/\s+/g, " ");
      assert.ok(sentence.includes(`${kes(flow.total_outflow)} went out and ${kes(flow.total_inflow)} came in.`), sentence.slice(0, 600));
      for (const label of ["Not yet classified", "Airtime", "Reversals (money out)", "Money out"]) assert.ok(shown.includes(label), label);
      assert.match(shown, /Fuliza/);
      assert.equal((shown.match(/of money out/g) ?? []).length, 5, "five areas going out, each with its share");
      assert.equal(await page.evaluate(`[...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).length`), 1);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("every door's Ledger scope adds up to its figure, is titled in words, and links back", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["F1", EDGE_IMPORT_ID]]) {
    test(`${label}: money out and in, each area, each part`, async () => {
      const page = await openPage(DESKTOP, `/breakdown?import=${id}`);
      try {
        const doors = await page.evaluate(`[...document.querySelectorAll('main a[href^="/ledger?scope="]')]
          .filter((a) => a.getBoundingClientRect().height > 0)
          .map((a) => ({ href: a.getAttribute("href"), amount: (a.textContent.match(/KES [0-9,]+\\.[0-9]{2}/) ?? [null])[0] }))
          .filter((door) => door.amount)`);
        const scopes = [...new Set(doors.map((door) => new URLSearchParams(door.href.split("?")[1]).get("scope")))];
        assert.ok(scopes.includes("money-out") && scopes.includes("money-in") && scopes.includes("bucket:spending"), scopes.join(" | "));
        if (id === EDGE_IMPORT_ID) assert.ok(scopes.includes("bucket:not-classified-out") && scopes.includes("bucket:airtime"), scopes.join(" | "));
        const seen = new Set();
        for (const door of doors) {
          if (seen.has(door.href)) continue;
          seen.add(door.href);
          await page.goto(`${web.origin}${door.href}`);
          await page.waitFor(`!!document.querySelector("[data-scope-totals]")`, `the Ledger at ${door.href}`, SLOW_STEP_MS);
          const totals = await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`);
          assert.ok(totals.includes(`up to ${door.amount}`), `${door.href}: ${door.amount} vs ${totals}`);
          const title = await page.evaluate(`document.querySelector("[data-scope-title]").textContent`);
          assert.doesNotMatch(title, /bucket:|money-out|money-in|-out\b|NO_ENTITY/, `${door.href}: title "${title}"`);
          const back = await page.evaluate(`[...document.querySelectorAll('main a[href^="/breakdown"]')].map((a) => a.getAttribute("href"))`);
          assert.ok(back.includes(`/breakdown?import=${id}`), `${door.href}: back link ${back.join(" | ")}`);
        }
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });
  }

  test("an area's Open link opens its screen on the import", async () => {
    const page = await openPage(DESKTOP, `/breakdown?import=${SAMPLE_IMPORT_ID}`);
    try {
      await page.click(`main article a[href="/breakdown/cash?import=${SAMPLE_IMPORT_ID}"]`);
      await page.waitFor(`location.pathname === "/breakdown/cash" && location.search === "?import=${SAMPLE_IMPORT_ID}"`, "the Cash area", SLOW_STEP_MS);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("accessibility", () => {
  test("area and part doors are reachable by Tab with visible focus; the hub is the current area; headings are semantic", async () => {
    const page = await openPage(DESKTOP, `/breakdown?import=${SAMPLE_IMPORT_ID}`);
    try {
      await page.send("Accessibility.enable");
      const { nodes } = await page.send("Accessibility.getFullAXTree");
      const headings = nodes.filter((node) => !node.ignored && node.role?.value === "heading").map((node) => String(node.name?.value ?? ""));
      for (const heading of ["Why did my money move the way it did?", "Where money went", "Where money came from", "How the parts add up"]) assert.ok(headings.includes(heading), heading);
      await page.evaluate(`document.querySelector('main a[href*="scope=money-out"]').focus(); true`);
      let reached = null;
      for (let step = 0; step < 6 && !reached; step += 1) {
        await press(page, "Tab", "Tab", 9);
        reached = await page.evaluate(`(() => { const el = document.activeElement; return el.getAttribute("href")?.includes("scope=") ? { outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow } : null; })()`);
      }
      assert.ok(reached, "Tab reaches the next door");
      assert.ok(reached.outline !== "none" || reached.shadow !== "none", `keyboard focus is visible: ${JSON.stringify(reached)}`);
      const current = await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Breakdown areas"] [aria-current="page"]')].map((a) => a.getAttribute("href"))`);
      assert.deepEqual(current, [`/breakdown?import=${SAMPLE_IMPORT_ID}`]);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("empty and error states are never a zero-valued hub", () => {
  test("an area without rows: a real KES 0.00, said plainly, still openable (F4 has no savings)", async () => {
    const page = await openPage(DESKTOP, `/breakdown?import=${F4_IMPORT_ID}`);
    try {
      assert.match(await mainText(page), /KES 0\.00\s*None in this statement/);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("no imports: the no-statements card, the six areas to open, no figures", async () => {
    noImports = true;
    try {
      const page = await openPage(DESKTOP, "/breakdown", `document.querySelector("main").innerText.includes("No statements yet")`);
      try {
        assert.doesNotMatch(await mainText(page), /KES/);
        assert.equal(await page.evaluate(`document.querySelectorAll("main article a").length`), 6);
      } finally {
        await page.close();
      }
    } finally {
      noImports = false;
    }
  }, { timeout: 300_000 });

  test("analytics fail: the retryable error card, no figure, the areas still open", async () => {
    const page = await openPage(DESKTOP, `/breakdown?import=${ANALYTICS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const shown = await mainText(page);
      assert.match(shown, /Try again/);
      assert.doesNotMatch(shown, /KES/);
      assert.equal(await page.evaluate(`document.querySelectorAll("main article a").length`), 6);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("transactions fail (T-LOADFAIL): the API's totals stay without doors, the parts give way to a retryable error until Try again succeeds", async () => {
    rowsRecovered = false;
    const page = await openPage(DESKTOP, `/breakdown?import=${ROWS_DOWN_IMPORT_ID}`, `!!document.querySelector('main [role="alert"]')`);
    try {
      const failed = await mainText(page);
      assert.ok(failed.includes(kes(fixture.snapshot.result.cash_flow.total_outflow)), "the API's money out stays");
      assert.doesNotMatch(failed, /How the parts add up/);
      assert.equal(await page.evaluate(`!!document.querySelector('main a[href^="/ledger?scope"]')`), false, "no door while the rows are missing");
      rowsRecovered = true;
      await page.click('main [role="alert"] button');
      await page.waitFor(`[...document.querySelectorAll("main h2")].some((h) => h.textContent === "How the parts add up")`, "the parts after Try again", SLOW_STEP_MS);
    } finally {
      rowsRecovered = false;
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("layout at four widths", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["F1", EDGE_IMPORT_ID]]) {
    for (const viewport of VIEWPORTS) {
      test(`${label} at ${viewport.name}: no overflow, no clipped figure`, async () => {
        const page = await openPage(viewport, `/breakdown?import=${id}`);
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
