// The responsive application shell (IA migration Stage 3) in a real browser:
// on the six ingest pages, mobile and tablet show the mobile header and tab
// bar, and from 1024px the desktop app bar and footer replace them, with
// exactly one visible, accessible copy of each control. Processing has no
// navigation at any width. The user journeys run through the shell at a
// desktop and a phone width: sign in and out from the visible account button,
// upload → processing → analysis summary, and upload → processing → recovery
// → Try Again → analysis summary.
//
// The story screens (Stage 4a) on the same shell: the three story levels and
// Statement check on the current import at a phone and a desktop width, the
// statement period taken from the import's summary (and "Import #id", never a
// made-up period, when there is none), the interim Breakdown hub's doors and
// that no area is still "coming" (all six have screens since Stage 7f), and a walk from the hub to an area screen and
// on to the Ledger without losing the import.
//
// Real headless Chrome (support/cdp-browser.mjs) on a production build of a
// throwaway copy of the app (support/frontend-server.mjs), against a synthetic
// fake API (support/fake-api.mjs) serving fixture F5 (support/sample-api.mjs)
// plus synthetic login, logout and upload answers. The uploaded file is a
// synthetic PDF-like file written to a temp dir.
//
// Requirements: Google Chrome (CHROME_PATH), network access to Google Fonts,
// the repository's .venv (fixture F5).
//
// Run from web-prototype/ (builds a throwaway copy; a few minutes):
//   node --test --test-concurrency=1 tests/app-shell-browser.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { launchBrowser } from "./support/cdp-browser.mjs";
import { apiError, json, startFakeApi } from "./support/fake-api.mjs";
import {
  buildForProduction,
  copyAppToTempDir,
  removeTempDir,
  startProductionServer,
} from "./support/frontend-server.mjs";
import { prototypeSampleFixture, SAMPLE_IMPORT_ID, sampleReadResponder } from "./support/sample-api.mjs";

const DESKTOP_BREAKPOINT = 1024;
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
];
const JOURNEY_VIEWPORTS = [VIEWPORTS[3], VIEWPORTS[0]];
const INGEST_TAB_HREFS = ["/upload", "/ledger", "/breakdown/fees"];
const USERNAME = "shell-user";
const VERIFICATION_TOKEN = "SYN-VERIFY-0001";
const SESSION_TOKEN_KEY = "mpesa.session.token";
const SESSION_USER_KEY = "mpesa.session.username";
const SLOW_STEP_MS = 120_000;
/** A synthetic import with the longest period lib/format.ts produces ("30 Sept 2024 – 29 Sept 2025"). */
const LONG_PERIOD_IMPORT = { id: 2, period_start: "2024-09-30", period_end: "2025-09-29" };
const LONG_PERIOD = "30 Sept 2024 – 29 Sept 2025";
/** An import whose summary loads but whose analytics fail (503). */
const ANALYTICS_DOWN_IMPORT_ID = 3;
/** An import whose summary and analytics load but whose transactions fail (503). */
const ROWS_DOWN_IMPORT_ID = 4;

/**
 * The six pages and the shell each must show: whether it has the ingest tab
 * bar on mobile, the desktop bar and footer from 1024px, and which tab is
 * current.
 */
const PAGES = [
  { route: "/", mobileNav: true, desktopShell: true, activeTab: "/upload" },
  { route: "/login", mobileNav: false, desktopShell: true, activeTab: null, signedOut: true },
  { route: "/upload", mobileNav: true, desktopShell: true, activeTab: "/upload" },
  { route: "/processing", mobileNav: false, desktopShell: false, activeTab: null },
  { route: "/recovery", mobileNav: true, desktopShell: true, activeTab: "/upload" },
  { route: `/analysis-summary?import=${SAMPLE_IMPORT_ID}`, mobileNav: true, desktopShell: true, activeTab: "/upload" },
];

/** How the fake API answers the next uploads, oldest first; then success. */
let uploadFailures = [];
/** Calls the fake API received, as "METHOD /path". */
const apiCalls = [];

/** Fixture F5 as served by the fake API. */
let fixture;
let api;
let appDir;
let web;
let browser;
let fileDir;
let syntheticPdf;

before(async () => {
  fileDir = mkdtempSync(join(tmpdir(), "app-shell-"));
  syntheticPdf = join(fileDir, "synthetic-statement.pdf");
  writeFileSync(syntheticPdf, "%PDF-1.4\n% synthetic test file, not a statement\n");
  fixture = prototypeSampleFixture();
  // Answers beyond fixture F5's reads: sign-in, sign-out, uploads, a second
  // import whose period is the longest the app formats, and two imports
  // (same period as F5) whose analytics or transactions are unavailable.
  const otherAnswers = ({ method, path }) => {
    if (method === "POST" && path === "/api/v1/auth/login") {
      return json(200, { access_token: "synthetic-shell-token", expires_at: "2099-01-01T00:00:00+00:00", username: USERNAME });
    }
    if (method === "POST" && path === "/api/v1/auth/logout") return json(204, null);
    if (method === "POST" && path === "/api/v1/imports") {
      const failure = uploadFailures.shift();
      if (failure) return apiError(failure.status, failure.code);
      return json(201, { import: fixture.summary, analytics: fixture.snapshot.result, verification_token: VERIFICATION_TOKEN });
    }
    if (method === "GET" && path === `/api/v1/imports/${LONG_PERIOD_IMPORT.id}`) {
      return json(200, { ...fixture.summary, ...LONG_PERIOD_IMPORT });
    }
    // Like every completed import, it has analytics (the API contract); the
    // story shell loads them together with the summary.
    if (method === "GET" && path === `/api/v1/imports/${LONG_PERIOD_IMPORT.id}/analytics`) {
      return json(200, { ...fixture.snapshot, import_id: LONG_PERIOD_IMPORT.id });
    }
    for (const id of [ANALYTICS_DOWN_IMPORT_ID, ROWS_DOWN_IMPORT_ID]) {
      if (method === "GET" && path === `/api/v1/imports/${id}`) return json(200, { ...fixture.summary, id });
    }
    if (method === "GET" && path === `/api/v1/imports/${ANALYTICS_DOWN_IMPORT_ID}/analytics`) return apiError(503, "service_unavailable");
    if (method === "GET" && path === `/api/v1/imports/${ROWS_DOWN_IMPORT_ID}/analytics`) {
      return json(200, { ...fixture.snapshot, import_id: ROWS_DOWN_IMPORT_ID });
    }
    if (method === "GET" && path === `/api/v1/imports/${ROWS_DOWN_IMPORT_ID}/transactions`) return apiError(503, "service_unavailable");
    return null;
  };
  const reads = sampleReadResponder(fixture, otherAnswers);
  api = await startFakeApi((request) => {
    apiCalls.push(`${request.method} ${request.path}`);
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
  if (fileDir) rmSync(fileDir, { recursive: true, force: true });
});

/** A new tab at `viewport`, optionally signed in with a synthetic session, at `route`. */
async function openPage(viewport, route, { signedIn }) {
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.goto(`${web.origin}/login`);
  await page.evaluate(
    signedIn
      ? `sessionStorage.setItem("${SESSION_TOKEN_KEY}", "synthetic-shell-token"); sessionStorage.setItem("${SESSION_USER_KEY}", "${USERNAME}"); true`
      : "sessionStorage.clear(); true",
  );
  await page.goto(`${web.origin}${route}`);
  await page.waitFor(`!!document.querySelector("main h1")`, `the ${route} heading`, SLOW_STEP_MS);
  await page.waitForNetworkIdle();
  return page;
}

/**
 * What a user can see of the shell: visible headers, navs and footers, the
 * hrefs and current tab of each visible nav, the visible account buttons,
 * the number of account buttons in the DOM, the visible buttons by
 * accessible name (aria-label, else text), and horizontal overflow.
 */
function visibleShell(page) {
  return page.evaluate(`(() => {
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const visible = (selector) => [...document.querySelectorAll(selector)].filter(shown);
    const accountSelector = 'button[aria-label="Sign in"], button[aria-label^="Sign out"]';
    return {
      headers: visible("header").length,
      footers: visible("footer").length,
      navs: visible("nav").map((nav) => ({
        hrefs: [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")),
        current: [...nav.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href")),
      })),
      accountButtons: visible(accountSelector).map((b) => b.getAttribute("aria-label")),
      accountButtonsInDom: document.querySelectorAll(accountSelector).length,
      visibleButtonNames: visible("button").map((b) => {
        if (b.hasAttribute("aria-label")) return b.getAttribute("aria-label").trim();
        const text = b.cloneNode(true);
        text.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
        return text.textContent.replace(/\\s+/g, " ").trim();
      }),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
}

/** The accessibility tree's non-ignored nodes, as { role, name }. */
async function accessibleNodes(page) {
  await page.send("Accessibility.enable");
  const { nodes } = await page.send("Accessibility.getFullAXTree");
  return nodes
    .filter((node) => !node.ignored)
    .map((node) => ({ role: node.role?.value ?? "", name: String(node.name?.value ?? "").trim() }));
}

/** Click the first visible button whose text contains `text`; fails if there is none or it is disabled. */
async function clickVisibleButton(page, text) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes(${JSON.stringify(text)}) && b.getBoundingClientRect().height > 0);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.ok(clicked, `no enabled visible "${text}" button`);
}

/** Choose the synthetic PDF on /upload and press Proceed. */
async function proceedWithSyntheticPdf(page) {
  await page.waitFor(`!!document.querySelector('input[type="file"]')`, "the file input", SLOW_STEP_MS);
  const { root } = await page.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
  await page.send("DOM.setFileInputFiles", { nodeId, files: [syntheticPdf] });
  await page.waitFor(
    `[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Proceed to Analysis") && !b.disabled)`,
    "an enabled Proceed button",
  );
  await clickVisibleButton(page, "Proceed to Analysis");
}

/** Wait for the analysis summary of the uploaded import, showing its verification code. */
async function waitForUploadedSummary(page) {
  await page.waitFor(
    `location.pathname === "/analysis-summary" && new URLSearchParams(location.search).get("import") === "${SAMPLE_IMPORT_ID}" && document.body.innerText.includes(${JSON.stringify(VERIFICATION_TOKEN)})`,
    "the analysis summary with this tab's verification code",
    SLOW_STEP_MS,
  );
}

describe("shell controls on the six pages", () => {
  for (const viewport of VIEWPORTS) {
    const isDesktop = viewport.width >= DESKTOP_BREAKPOINT;
    for (const spec of PAGES) {
      test(`${spec.route} at ${viewport.name}`, async () => {
        const page = await openPage(viewport, spec.route, { signedIn: !spec.signedOut });
        try {
          const shell = await visibleShell(page);
          const showsNav = isDesktop ? spec.desktopShell : spec.mobileNav;

          assert.equal(shell.headers, 1, "exactly one visible header");
          assert.equal(shell.overflow, false, "horizontal overflow");
          assert.equal(shell.footers, isDesktop && spec.desktopShell ? 1 : 0, "visible footers");
          assert.equal(shell.navs.length, showsNav ? 1 : 0, "visible navs");
          if (showsNav) {
            assert.deepEqual(shell.navs[0].hrefs, INGEST_TAB_HREFS);
            assert.deepEqual(shell.navs[0].current, spec.activeTab ? [spec.activeTab] : []);
          }
          const expectedLabel = spec.signedOut ? "Sign in" : `Sign out ${USERNAME}`;
          assert.deepEqual(shell.accountButtons, [expectedLabel], "exactly one visible account button");
          // Pages with both shells keep a hidden duplicate: the ambiguity a
          // first-match click would get wrong.
          assert.equal(shell.accountButtonsInDom, spec.desktopShell ? 2 : 1, "account buttons in the DOM");

          const nodes = await accessibleNodes(page);
          const named = (role, name) => nodes.filter((n) => n.role === role && n.name === name).length;
          // Hidden duplicates must not reach the accessibility tree: it names
          // exactly the visible buttons (on /login the form's submit button
          // is also called "Sign in").
          const visibleNamed = shell.visibleButtonNames.filter((name) => name === expectedLabel).length;
          assert.equal(named("button", expectedLabel), visibleNamed, "account-labelled buttons in the accessibility tree");
          assert.equal(nodes.filter((n) => n.role === "banner").length, 1, "one banner landmark");
          assert.equal(nodes.filter((n) => n.role === "contentinfo").length, isDesktop && spec.desktopShell ? 1 : 0, "contentinfo landmarks");
          assert.equal(nodes.filter((n) => n.role === "navigation").length, showsNav ? 1 : 0, "navigation landmarks");
          assert.equal(nodes.filter((n) => n.role === "main").length, 1, "one main landmark");
          assert.ok(nodes.some((n) => n.role === "heading" && n.name), "a named heading");
          const unnamed = nodes.filter((n) => ["button", "link"].includes(n.role) && !n.name);
          assert.deepEqual(unnamed, [], "controls without an accessible name");
        } finally {
          await page.close();
        }
      }, { timeout: 180_000 });
    }
  }
});

describe("user journeys through the shell", () => {
  for (const viewport of JOURNEY_VIEWPORTS) {
    test(`sign in and sign out with the visible account button at ${viewport.name}`, async () => {
      const page = await openPage(viewport, "/", { signedIn: false });
      try {
        await page.click('button[aria-label="Sign in"]');
        await page.waitFor(`location.pathname === "/login" && !!document.querySelector('input[type="password"]')`, "the login form");
        await page.type('input[autocomplete="username"]', USERNAME);
        await page.type('input[type="password"]', "synthetic-password");
        await page.click('button[type="submit"]');
        await page.waitFor(`location.pathname === "/upload"`, "the default destination after sign-in", SLOW_STEP_MS);
        await page.waitForNetworkIdle();
        assert.equal(await page.evaluate(`sessionStorage.getItem("${SESSION_USER_KEY}")`), USERNAME);
        assert.deepEqual((await visibleShell(page)).accountButtons, [`Sign out ${USERNAME}`]);

        const logoutsBefore = apiCalls.filter((call) => call === "POST /api/v1/auth/logout").length;
        await page.click('button[aria-label^="Sign out"]');
        await page.waitFor(`location.pathname === "/login"`, "the login page after sign-out");
        await page.waitForNetworkIdle();
        const logouts = apiCalls.filter((call) => call === "POST /api/v1/auth/logout").length;
        assert.equal(logouts - logoutsBefore, 1, "sign-out reached the API once");
        assert.equal(await page.evaluate("sessionStorage.length"), 0, "session left in storage after sign-out");
        assert.deepEqual((await visibleShell(page)).accountButtons, ["Sign in"]);
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });

    test(`upload → processing → analysis summary at ${viewport.name}`, async () => {
      uploadFailures = [];
      const page = await openPage(viewport, "/upload", { signedIn: true });
      try {
        await proceedWithSyntheticPdf(page);
        await waitForUploadedSummary(page);
        const shell = await visibleShell(page);
        assert.equal(shell.footers, viewport.width >= DESKTOP_BREAKPOINT ? 1 : 0);
        assert.equal(shell.navs.length, 1);
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });

    test(`upload → processing → recovery → Try Again → analysis summary at ${viewport.name}`, async () => {
      uploadFailures = [{ status: 503, code: "server_busy" }];
      const page = await openPage(viewport, "/upload", { signedIn: true });
      try {
        await proceedWithSyntheticPdf(page);
        await page.waitFor(
          `location.pathname === "/recovery" && document.body.innerText.includes("server_busy")`,
          "the recovery screen showing the failure code",
          SLOW_STEP_MS,
        );
        assert.equal((await visibleShell(page)).headers, 1);
        await clickVisibleButton(page, "Try Again");
        await waitForUploadedSummary(page);
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });
  }
});

/** Fixture F5's period as the story shell formats it (lib/format.ts formatPeriod). */
const SAMPLE_PERIOD = "1 Jul 2024 – 31 Jul 2024";
const STORY_LEVELS = ["/overview", "/breakdown", "/ledger"];

/** A JS expression: whether the page shows a receipt number of fixture F5. */
function showsSampleReceipt() {
  const receipts = JSON.stringify([...new Set(fixture.rows.map((row) => row.receipt_no))]);
  return `${receipts}.some((receipt) => document.body.innerText.includes(receipt))`;
}

/**
 * What a user can see of a story screen's shell: the visible h1 texts, the
 * story-level hrefs of every visible nav except the Breakdown area switcher,
 * the current level, the statement label in the visible header, the visible
 * Statement check links and the visible account buttons. Level navs are the
 * ones linking to Overview.
 */
function visibleStoryShell(page) {
  return page.evaluate(`(() => {
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const visible = (selector) => [...document.querySelectorAll(selector)].filter(shown);
    // The story levels are the nav that links to Overview; other navs (the
    // Breakdown area switcher, the Ledger's views) are not levels.
    const levelNavs = visible("nav").filter((nav) => !!nav.querySelector('a[href^="/overview"]'));
    return {
      headings: visible("h1").map((h) => h.textContent.trim()),
      levelNavs: levelNavs.map((nav) => [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"))),
      current: levelNavs.flatMap((nav) => [...nav.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"))),
      headerText: visible("header").map((h) => h.innerText.replace(/\\s+/g, " ")).join(" | "),
      statementCheck: visible('a[aria-label="Statement check"]').map((a) => a.getAttribute("href")),
      accountButtons: visible('button[aria-label="Sign in"], button[aria-label^="Sign out"]').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
}

describe("story screens on the shell", () => {
  const STORY_PAGES = [
    { route: "/overview", title: "Overview", level: "/overview" },
    { route: "/breakdown", title: "Breakdown", level: "/breakdown" },
    { route: "/breakdown/spending", title: "Spending", level: "/breakdown" },
    { route: "/ledger", title: "Ledger", level: "/ledger" },
  ];
  for (const viewport of JOURNEY_VIEWPORTS) {
    for (const spec of STORY_PAGES) {
      test(`${spec.route}?import=${SAMPLE_IMPORT_ID} at ${viewport.name}`, async () => {
        const page = await openPage(viewport, `${spec.route}?import=${SAMPLE_IMPORT_ID}`, { signedIn: true });
        try {
          const scoped = (href) => `${href}?import=${SAMPLE_IMPORT_ID}`;
          await page.waitFor(`[...document.querySelectorAll("header")].some((h) => h.getBoundingClientRect().height > 0 && h.innerText.toLowerCase().includes(${JSON.stringify(SAMPLE_PERIOD.toLowerCase())}))`, "the statement period in the visible header");
          const shell = await visibleStoryShell(page);
          assert.deepEqual(shell.headings, [spec.title], "exactly one visible h1, the screen title");
          assert.deepEqual(shell.levelNavs, [STORY_LEVELS.map(scoped)], "one visible set of story levels, on the import");
          assert.deepEqual(shell.current, [scoped(spec.level)]);
          assert.deepEqual(shell.statementCheck, [`/analysis-summary?import=${SAMPLE_IMPORT_ID}`]);
          assert.equal(shell.accountButtons, 1);
          assert.equal(shell.overflow, false, "horizontal overflow");
          assert.doesNotMatch(shell.headerText, /verified/i);
          assert.deepEqual(page.exceptions, [], "uncaught exceptions");

          const nodes = await accessibleNodes(page);
          assert.equal(nodes.filter((n) => n.role === "banner").length, 1, "one banner landmark");
          assert.deepEqual(nodes.filter((n) => ["button", "link"].includes(n.role) && !n.name), [], "controls without an accessible name");
        } finally {
          await page.close();
        }
      }, { timeout: 180_000 });
    }
  }

  const FIT_CASES = [
    ...["/overview", "/breakdown", "/ledger"].map((route) => ({ path: `${route}?import=${SAMPLE_IMPORT_ID}`, period: SAMPLE_PERIOD })),
    // The hub's body loads nothing, so this import needs only its summary.
    { path: `/breakdown?import=${LONG_PERIOD_IMPORT.id}`, period: LONG_PERIOD },
  ];
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[3]]) {
    for (const { path, period } of FIT_CASES) {
      test(`desktop bar fits with the statement chip: ${path} at ${viewport.name}`, async () => {
        const page = await openPage(viewport, path, { signedIn: true });
        try {
          await page.waitFor(`[...document.querySelectorAll("header")].some((h) => h.getBoundingClientRect().height > 0 && h.innerText.toLowerCase().includes(${JSON.stringify(period.toLowerCase())}))`, "the statement period in the desktop bar");
          const bar = await page.evaluate(`(() => {
            const header = [...document.querySelectorAll("header")].find((h) => h.getBoundingClientRect().height > 0);
            const row = header.firstElementChild;
            const groups = [...row.children].map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, overflows: el.scrollWidth > el.clientWidth + 1 }; });
            // The innermost element that holds the format label is the chip itself.
            const chip = [...header.querySelectorAll("div")].filter((el) => el.innerText.includes("M-PESA statement")).at(-1);
            const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            return {
              groups,
              rowOverflows: row.scrollWidth > row.clientWidth + 1,
              chipText: chip && shown(chip) ? chip.innerText.replace(/\\s+/g, " ").trim() : null,
              tabs: [...header.querySelectorAll("nav a")].filter(shown).length,
              statementCheck: [...header.querySelectorAll('a[aria-label="Statement check"]')].filter(shown).length,
              account: [...header.querySelectorAll('button[aria-label^="Sign"]')].filter(shown).length,
              innerWidth,
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
            };
          })()`);
          assert.equal(bar.chipText?.toLowerCase(), `${period} • M-PESA statement`.toLowerCase(), "the statement chip");
          assert.equal(bar.groups.length, 3, "brand and chip, tabs, actions");
          for (const [index, group] of bar.groups.entries()) {
            assert.ok(group.left >= 0 && group.right <= bar.innerWidth, `group ${index} inside the viewport`);
            assert.equal(group.overflows, false, `group ${index} overflows its box`);
            if (index > 0) assert.ok(bar.groups[index - 1].right <= group.left, `group ${index - 1} overlaps group ${index}`);
          }
          assert.equal(bar.rowOverflows, false, "the bar's row overflows");
          assert.equal(bar.tabs, 3, "all three story levels visible");
          assert.equal(bar.statementCheck, 1, "Statement check visible");
          assert.equal(bar.account, 1, "account control visible");
          assert.equal(bar.pageOverflow, false, "horizontal overflow");
          assert.deepEqual(page.exceptions, [], "uncaught exceptions");

          // The compacted brand keeps its name for assistive technology.
          const nodes = await accessibleNodes(page);
          assert.ok(nodes.some((n) => n.role === "link" && /sovereign ledger/i.test(n.name)), "the brand link's accessible name");
          assert.deepEqual(nodes.filter((n) => ["button", "link"].includes(n.role) && !n.name), [], "controls without an accessible name");
        } finally {
          await page.close();
        }
      }, { timeout: 180_000 });
    }
  }

  for (const viewport of JOURNEY_VIEWPORTS) {
    test(`failed analytics don't cost the shell its period at ${viewport.name}`, async () => {
      const page = await openPage(viewport, `/overview?import=${ANALYTICS_DOWN_IMPORT_ID}`, { signedIn: true });
      try {
        await page.waitFor(`!!document.querySelector('main [role="alert"]')`, "the body's error card");
        const shell = await visibleStoryShell(page);
        assert.ok(shell.headerText.toLowerCase().includes(SAMPLE_PERIOD.toLowerCase()), `header: ${shell.headerText}`);
        const retry = await page.evaluate(`[...document.querySelectorAll('main [role="alert"] button')].some((b) => b.textContent.includes("Try again"))`);
        assert.equal(retry, true, "the analytics failure is retryable");
        assert.deepEqual(page.exceptions, [], "uncaught exceptions");
      } finally {
        await page.close();
      }
    }, { timeout: 180_000 });
  }

  test("failed transactions keep the import, its period and its ribbon (T-LOADFAIL)", async () => {
    const page = await openPage(VIEWPORTS[3], `/ledger?import=${ROWS_DOWN_IMPORT_ID}`, { signedIn: true });
    try {
      await page.waitFor(`!!document.querySelector('main [role="alert"]')`, "the transaction list's error card");
      const shell = await visibleStoryShell(page);
      assert.ok(shell.headerText.toLowerCase().includes(SAMPLE_PERIOD.toLowerCase()), `header: ${shell.headerText}`);
      const ribbon = await page.evaluate(`document.querySelector("main").innerText.toLowerCase().includes(${JSON.stringify(SAMPLE_PERIOD.toLowerCase())})`);
      assert.equal(ribbon, true, "the import's period ribbon stays in the body");
      assert.deepEqual(page.exceptions, [], "uncaught exceptions");
    } finally {
      await page.close();
    }
  }, { timeout: 180_000 });

  test("a summary that cannot be loaded names the import, not a made-up period", async () => {
    const page = await openPage(VIEWPORTS[3], "/overview?import=99", { signedIn: true });
    try {
      // The screen body reports the failed load in its own error card (a 404 here).
      await page.waitFor(`!!document.querySelector('main [role="alert"]')`, "the screen's error card");
      const shell = await visibleStoryShell(page);
      assert.match(shell.headerText, /Import #99/i);
      assert.doesNotMatch(shell.headerText, /\b20\d\d\b/);
      assert.deepEqual(shell.levelNavs, [STORY_LEVELS.map((href) => `${href}?import=99`)]);
      assert.deepEqual(page.exceptions, [], "uncaught exceptions");
    } finally {
      await page.close();
    }
  }, { timeout: 180_000 });

  for (const viewport of JOURNEY_VIEWPORTS) {
    test(`hub → Spending → Ledger keeps the import at ${viewport.name}`, async () => {
      const page = await openPage(viewport, `/breakdown?import=${SAMPLE_IMPORT_ID}`, { signedIn: true });
      try {
        const coming = await page.evaluate(`(() => {
          const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          return {
            notes: [...document.querySelectorAll("main article")].filter(shown).filter((a) => a.innerText.toLowerCase().includes("coming in this release")).length,
          };
        })()`);
        // Stages 7e and 7f gave Cash and Money In their screens: nothing is still to come.
        assert.equal(coming.notes, 0, "no area is named as coming in this release");

        // Stage 7a: the hub opens the migrated Spending area.
        await page.click(`main a[href="/breakdown/spending?import=${SAMPLE_IMPORT_ID}"]`);
        await page.waitFor(`location.pathname === "/breakdown/spending" && location.search === "?import=${SAMPLE_IMPORT_ID}"`, "the Spending area on the import", SLOW_STEP_MS);
        await page.waitForNetworkIdle();
        assert.deepEqual((await visibleStoryShell(page)).current, [`/breakdown?import=${SAMPLE_IMPORT_ID}`]);

        await page.click(`nav a[href="/ledger?import=${SAMPLE_IMPORT_ID}"]`);
        await page.waitFor(`location.pathname === "/ledger" && location.search === "?import=${SAMPLE_IMPORT_ID}"`, "the Ledger on the import", SLOW_STEP_MS);
        await page.waitFor(`${showsSampleReceipt()}`, "the import's rows in the Ledger", SLOW_STEP_MS);
        assert.deepEqual((await visibleStoryShell(page)).current, [`/ledger?import=${SAMPLE_IMPORT_ID}`]);
        assert.deepEqual(page.exceptions, [], "uncaught exceptions");
      } finally {
        await page.close();
      }
    }, { timeout: 300_000 });
  }

  test("the hub's Ledger door opens the latest import's Ledger when no import is given", async () => {
    const page = await openPage(VIEWPORTS[3], "/breakdown", { signedIn: true });
    try {
      await page.click('main a[title^="See every transaction"]');
      await page.waitFor(`location.pathname === "/ledger" && location.search === ""`, "the Ledger without an import", SLOW_STEP_MS);
      await page.waitFor(`${showsSampleReceipt()}`, "the latest import's rows", SLOW_STEP_MS);
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});
