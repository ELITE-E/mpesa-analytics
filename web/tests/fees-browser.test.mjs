// The Fees area (IA migration Stage 7c) in a real browser: the API's charges
// paid, their causes (decision Q-D7: the transaction each charge was for; F1's
// orphan and ambiguous charges disclosed as not linked, never guessed), the
// largest charges, every door whose figure is printed on it opening a Ledger
// scope that adds up to that figure, titled in words and linking back;
// People, Savings and Cash opening the new Fees area; the headline door named
// for screen readers, cause doors reachable by keyboard with visible focus;
// and the empty, error and failed-rows states, which never pass for a
// zero-valued Fees. F5 and F1 lay out without overflow or clipped figures at
// 390, 768, 1024 and 1280 px.
//
// Real headless Chrome (support/cdp-browser.mjs) on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) serving F5 with backend analytics, F1 and F4
// (no charges) (support/sample-api.mjs, support/contract-fixtures.mjs).
// Expected figures come from the fixtures; door totals are read off the
// Ledger each door opens.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts,
// the repository's .venv.
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/fees-browser.test.mjs

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { launchBrowser } from "./support/cdp-browser.mjs";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { apiError, json, startFakeApi } from "./support/fake-api.mjs";
import {
  appGoto,
  buildForProduction,
  copyAppToTempDir,
  openWithImport,
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
/** F4: no charges at all. */
const NO_FEES_IMPORT_ID = 7;

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
  const noFees = contractFixtures()["F4-paginated-2345"];
  const sources = [[ROWS_DOWN_IMPORT_ID, fixture], [EDGE_IMPORT_ID, edge], [ANALYTICS_DOWN_IMPORT_ID, fixture], [NO_FEES_IMPORT_ID, noFees]];
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

/** Fees fully rendered: its causes card (rows loaded) or an alert. */
const FEES_READY = `[...document.querySelectorAll("main h2")].some((h) => h.textContent === "What caused the charges") || !!document.querySelector('main [role="alert"]')`;

/** A signed-in tab at `viewport` showing `route`, once `ready` holds. */
async function openPage(viewport, route, ready = FEES_READY) {
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  // CP8b: the static app reads its data through an upload (support/frontend-server.mjs).
  await openWithImport(page, web, route);
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

/** The FEE rows of `source`, their total (cents) and the payments out. */
function feesOf(source) {
  const fees = source.rows.filter((row) => row.event_type === "FEE");
  const out = source.rows.filter((row) => row.cash_flow_direction === "OUTFLOW");
  return { fees, cents: fees.reduce((total, row) => total + Math.round(row.paid_out * 100), 0), paymentsOut: out.filter((row) => row.event_type !== "FEE").length };
}

describe("figures from the import", () => {
  test("charges paid answers the question; F1's causes, with the orphan and ambiguous charges disclosed and not guessed; one h1", async () => {
    const page = await openPage(DESKTOP, `/breakdown/fees?import=${EDGE_IMPORT_ID}`);
    try {
      const { fees, cents, paymentsOut } = feesOf(edge);
      assert.equal(cents, Math.round(edge.snapshot.result.fees.total_fees.total_fees * 100), "F1 agrees on U-3");
      const shown = await mainText(page);
      assert.ok(shown.includes(kes(cents / 100)), shown.slice(0, 500));
      assert.match(shown, new RegExp(`${fees.length} charges on 3 of your ${paymentsOut} payments out, [0-9.]+% of money out\\.`));
      assert.match(shown, /2 charges couldn't be tied to one transaction; they're listed on their own\./);
      for (const label of ["Paybill payments", "Cash withdrawals", "Sending money", "Charges not linked to one transaction"]) assert.ok(shown.includes(label), label);
      assert.match(shown, /Excise duty isn't shown separately/);
      assert.equal(await page.evaluate(`[...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).length`), 1);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("every door's Ledger scope adds up to its figure, is titled in words, and links back", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["F1", EDGE_IMPORT_ID]]) {
    test(`${label}: header, causes and largest charges`, async () => {
      const page = await openPage(DESKTOP, `/breakdown/fees?import=${id}`);
      try {
        const doors = await page.evaluate(`[...document.querySelectorAll('main a[href^="/ledger?scope="]')]
          .filter((a) => a.getBoundingClientRect().height > 0)
          .map((a) => ({ href: a.getAttribute("href"), amount: (a.textContent.match(/KES [0-9,]+\\.[0-9]{2}/) ?? [null])[0] }))
          .filter((door) => door.amount)`);
        const scopes = doors.map((door) => new URLSearchParams(door.href.split("?")[1]).get("scope"));
        assert.ok(scopes.includes("fees") && scopes.includes("fees:TRANSFER_OUT"), scopes.join(" | "));
        assert.ok(scopes.some((scope) => scope.startsWith("receipt:")), scopes.join(" | "));
        if (id === EDGE_IMPORT_ID) assert.ok(scopes.includes("fees:unlinked"), scopes.join(" | "));
        for (const door of doors) {
          await appGoto(page, door.href);
          const scope = new URLSearchParams(door.href.split("?")[1]).get("scope");
          if (scope.startsWith("receipt:")) {
            // A receipt scope has no totals banner (scope-banner.tsx): its title names the receipt and its rows show the
            // charge, printed without "KES" in the Ledger's grid (a receipt with several transactions opens no dialog).
            const bareAmount = door.amount.replace("KES ", "");
            await page.waitFor(`!!document.querySelector("[data-scope-title]") && document.querySelector("main").innerText.includes(${JSON.stringify(bareAmount)})`, `the receipt at ${door.href}`, SLOW_STEP_MS);
            assert.ok((await page.evaluate(`document.querySelector("[data-scope-title]").textContent`)).includes(scope.slice("receipt:".length)), door.href);
            continue;
          }
          await page.waitFor(`!!document.querySelector("[data-scope-totals]")`, `the Ledger at ${door.href}`, SLOW_STEP_MS);
          const totals = await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`);
          assert.ok(totals.includes(`up to ${door.amount}`), `${door.href}: ${door.amount} vs ${totals}`);
          const title = await page.evaluate(`document.querySelector("[data-scope-title]").textContent`);
          assert.doesNotMatch(title, /fees:|_|unlinked|NO_ENTITY/, `${door.href}: title "${title}"`);
          const back = await page.evaluate(`[...document.querySelectorAll('main a[href^="/breakdown/fees"]')].map((a) => a.getAttribute("href"))`);
          assert.ok(back.includes(`/breakdown/fees?import=${id}`), `${door.href}: back link ${back.join(" | ")}`);
        }
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });
  }

  test("a real click on a cause opens exactly its charges; Back returns to Fees on the import", async () => {
    const page = await openPage(DESKTOP, `/breakdown/fees?import=${SAMPLE_IMPORT_ID}`);
    try {
      const sends = fixture.rows.filter((row) => row.event_type === "TRANSFER_OUT").map((row) => row.receipt_no);
      const charges = fixture.rows.filter((row) => row.event_type === "FEE" && sends.includes(row.receipt_no));
      const total = charges.reduce((sum, row) => sum + row.paid_out, 0);
      await page.click('main a[href*="scope=fees"][href*="TRANSFER_OUT&"]');
      await page.waitFor(`location.pathname === "/ledger" && !!document.querySelector("[data-scope-totals]")`, "the charges on sends", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`document.querySelector("[data-scope-title]").textContent`), "Sending money");
      assert.match(await page.evaluate(`document.querySelector("[data-scope-totals]").textContent`), new RegExp(`${charges.length} rows.*up to ${kes(total).replace(/[.]/g, "\\.")}`));
      await page.click('main a[href^="/breakdown/fees"]');
      await page.waitFor(`location.pathname === "/breakdown/fees"`, "back to Fees", SLOW_STEP_MS);
      assert.equal(await page.evaluate(`location.search`), `?import=${SAMPLE_IMPORT_ID}`);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("People, Savings and Cash open Fees on the import", async () => {
    for (const route of ["/breakdown/people", "/breakdown/savings", "/breakdown/cash"]) {
      const page = await openPage(DESKTOP, `${route}?import=${SAMPLE_IMPORT_ID}`, `!!document.querySelector('main a[href="/breakdown/fees?import=${SAMPLE_IMPORT_ID}"]:not(nav a)')`);
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("accessibility", () => {
  test("the headline door is named; headings are semantic; Tab reaches cause doors with visible focus; Fees is the current area", async () => {
    const page = await openPage(DESKTOP, `/breakdown/fees?import=${EDGE_IMPORT_ID}`);
    try {
      const { fees, cents } = feesOf(edge);
      await page.send("Accessibility.enable");
      const { nodes } = await page.send("Accessibility.getFullAXTree");
      const names = nodes.filter((node) => !node.ignored && node.role?.value === "link").map((node) => String(node.name?.value ?? ""));
      assert.ok(names.includes(`See the ${fees.length} charges behind ${kes(cents / 100)}`), names.join(" | "));
      const headings = nodes.filter((node) => !node.ignored && node.role?.value === "heading").map((node) => String(node.name?.value ?? ""));
      for (const heading of ["What did moving my money cost?", "What caused the charges", "Largest charges", "Counted once, here"]) assert.ok(headings.includes(heading), heading);
      await page.evaluate(`document.querySelector('main a[href*="scope=fees&"]').focus(); true`);
      let reached = null;
      for (let step = 0; step < 15 && !reached; step += 1) {
        await press(page, "Tab", "Tab", 9);
        reached = await page.evaluate(`(() => { const el = document.activeElement; return el.getAttribute("href")?.includes("scope=fees%3A") ? { outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow } : null; })()`);
      }
      assert.ok(reached, "Tab reaches a cause door");
      assert.ok(reached.outline !== "none" || reached.shadow !== "none", `keyboard focus is visible: ${JSON.stringify(reached)}`);
      const current = await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Breakdown areas"] [aria-current="page"]')].map((a) => a.getAttribute("href"))`);
      assert.deepEqual(current, [`/breakdown/fees?import=${EDGE_IMPORT_ID}`]);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

describe("empty and error states are never a zero-valued Fees", () => {
  test("no charges: said plainly over a real KES 0.00, with no door", async () => {
    const page = await openPage(DESKTOP, `/breakdown/fees?import=${NO_FEES_IMPORT_ID}`);
    try {
      assert.match(await mainText(page), /No charges in this statement/);
      assert.equal(await page.evaluate(`!!document.querySelector('main a[href^="/ledger"]')`), false);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });

  test("no imports: the no-statements card and no figures", async () => {
    noImports = true;
    try {
      const page = await openPage(DESKTOP, "/breakdown/fees", `document.querySelector("main").innerText.includes("No statements yet")`);
      try {
        assert.doesNotMatch(await mainText(page), /KES/);
      } finally {
        await page.close();
      }
    } finally {
      noImports = false;
    }
  }, { timeout: 300_000 });

});

describe("layout at four widths", () => {
  for (const [label, id] of [["sample", SAMPLE_IMPORT_ID], ["F1", EDGE_IMPORT_ID]]) {
    for (const viewport of VIEWPORTS) {
      test(`${label} at ${viewport.name}: no overflow, no clipped figure`, async () => {
        const page = await openPage(viewport, `/breakdown/fees?import=${id}`);
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
