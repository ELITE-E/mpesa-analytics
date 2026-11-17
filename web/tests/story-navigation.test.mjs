// Story navigation contracts (IA migration Stage 4a): the `import` query
// parameter that keeps every story screen on the same import (withImport,
// parseImportId), the summary lookup behind the story shell's period
// (getImportOrLatest), the three story levels, the desktop story tabs, and
// the interim Breakdown hub's doors.
//
// The real modules are rendered with renderToString; fetch is faked at the
// network edge and nothing leaves the process.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/story-navigation.test.mjs

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const API_BASE_URL = "https://api.app.test";

// Browser globals the client modules touch, set before the app is imported.
process.env.NEXT_PUBLIC_API_BASE_URL = API_BASE_URL;
const sessionStore = new Map([
  ["mpesa.session.token", "tok_STORY_NAV_TEST"],
  ["mpesa.session.username", "story-user"],
]);
globalThis.window = {
  sessionStorage: {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
  },
  location: new URL("https://app.test/overview"),
};

const { withImport, parseImportId } = await import("../src/lib/import-link.ts");
const { getImportOrLatest } = await import("../src/lib/api.ts");
const { StoryBottomNav } = await import("../src/components/story-bottom-nav.tsx");
const { storyPeriodLabel } = await import("../src/components/story-period.tsx");
const { StatementDataProvider } = await import("../src/components/statement-data.tsx");
const { DesktopAppBar } = await import("../src/components/layout/desktop-app-bar.tsx");
const { StoryScreen } = await import("../src/components/story-screen.tsx");
const { BreakdownNav } = await import("../src/components/analysis/breakdown-nav.tsx");
const { default: BreakdownPage } = await import("../src/app/breakdown/page.tsx");
const { formatPeriod } = await import("../src/lib/format.ts");

const SUMMARY = {
  id: 7,
  imported_at: "2026-07-31T09:00:00+00:00",
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  status: "completed",
  transaction_count: 12,
  previously_imported_transaction_count: 0,
  unclassified_transaction_count: 0,
  observation_counts: {},
};

/** API paths requested through the faked fetch, in order. */
let requestedPaths = [];

/** Fake the API: `answers` maps a path (with query) to [status, body]. */
function fakeApi(answers) {
  requestedPaths = [];
  globalThis.fetch = async (url) => {
    const path = String(url).slice(API_BASE_URL.length);
    requestedPaths.push(path);
    const [status, body] = answers[path] ?? [404, { error: { code: "not_found", message: "Not found." } }];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
}

/** Each link in `html` as { href, text, current }, in DOM order; text without icon ligatures. */
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    href: attributes.match(/href="([^"]*)"/)?.[1].replace(/&amp;/g, "&"),
    text: inner
      .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
    current: attributes.includes('aria-current="page"'),
  }));
}

afterEach(() => {
  delete globalThis.fetch;
});

describe("withImport", () => {
  test("adds the import to a path without a query", () => {
    assert.equal(withImport("/breakdown", 7), "/breakdown?import=7");
  });

  test("appends the import to an existing query without disturbing it", () => {
    assert.equal(withImport("/ledger?filter=unmapped", 7), "/ledger?filter=unmapped&import=7");
  });

  test("leaves the href unchanged without an import", () => {
    for (const id of [null, undefined]) assert.equal(withImport("/breakdown", id), "/breakdown");
  });
});

describe("parseImportId", () => {
  test("accepts a positive integer id, the first of repeated values", () => {
    assert.equal(parseImportId("7"), 7);
    assert.equal(parseImportId(["7", "8"]), 7);
  });

  test("rejects absent, non-numeric, fractional, zero and negative ids", () => {
    for (const value of [undefined, "", "abc", "1.5", "0", "-3", "7abc"]) {
      assert.equal(parseImportId(value), null, JSON.stringify(value));
    }
  });
});

describe("getImportOrLatest", () => {
  test("loads the requested import", async () => {
    fakeApi({ "/api/v1/imports/7": [200, SUMMARY] });
    assert.deepEqual(await getImportOrLatest(7), SUMMARY);
    assert.deepEqual(requestedPaths, ["/api/v1/imports/7"]);
  });

  test("without an id, loads the most recent import", async () => {
    fakeApi({ "/api/v1/imports?limit=1": [200, { items: [SUMMARY] }] });
    assert.deepEqual(await getImportOrLatest(null), SUMMARY);
    assert.deepEqual(requestedPaths, ["/api/v1/imports?limit=1"]);
  });

  test("is null when the user has no imports", async () => {
    fakeApi({ "/api/v1/imports?limit=1": [200, { items: [] }] });
    assert.equal(await getImportOrLatest(null), null);
  });

  test("rejects with the API's error for an import that is not the user's", async () => {
    fakeApi({});
    await assert.rejects(getImportOrLatest(99), (error) => error.code === "not_found" && error.status === 404);
  });
});

describe("StoryBottomNav: the three story levels", () => {
  test("names Overview, Breakdown and Ledger by label only, with their routes", () => {
    const html = renderToString(createElement(StoryBottomNav, {}));
    assert.deepEqual(
      links(html).map(({ href, text }) => ({ href, text })),
      [
        { href: "/overview", text: "Overview" },
        { href: "/breakdown", text: "Breakdown" },
        { href: "/ledger", text: "Ledger" },
      ],
    );
    assert.doesNotMatch(textOf(html), /What happened|Why\?|Prove it/);
  });

  test("keeps every level on the current import", () => {
    const tabs = links(renderToString(createElement(StoryBottomNav, { importId: 7 })));
    assert.deepEqual(tabs.map((tab) => tab.href), ["/overview?import=7", "/breakdown?import=7", "/ledger?import=7"]);
    for (const { href } of tabs) assert.equal(new URL(href, "https://app.test").searchParams.getAll("import").length, 1);
  });

  test("marks only the active level as the current page", () => {
    for (const active of ["overview", "breakdown", "ledger"]) {
      const tabs = links(renderToString(createElement(StoryBottomNav, { active, importId: 7 })));
      assert.deepEqual(tabs.filter((tab) => tab.current).map((tab) => tab.href), [`/${active}?import=7`]);
    }
    assert.deepEqual(links(renderToString(createElement(StoryBottomNav, {}))).filter((tab) => tab.current), []);
  });
});

/** The links inside the first <nav> of `html`. */
function navLinks(html) {
  return links(html.match(/<nav\b[\s\S]*?<\/nav>/)[0]);
}

/** Visible text of server-rendered `html`, entities decoded. */
function textOf(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("storyPeriodLabel: the statement the story shell names", () => {
  test("is the import's period once its summary has loaded", () => {
    assert.equal(storyPeriodLabel(7, SUMMARY), formatPeriod("2026-07-01", "2026-07-31"));
    assert.equal(storyPeriodLabel(null, SUMMARY), formatPeriod("2026-07-01", "2026-07-31"));
  });

  test("without a summary, names the requested import or the latest, never a period", () => {
    assert.equal(storyPeriodLabel(7, null), "Import #7");
    assert.equal(storyPeriodLabel(null, null), "Latest import");
  });
});

describe("DesktopAppBar: the desktop story tabs", () => {
  // As on every story screen (StoryScreen), inside the page's statement data.
  const html = renderToString(
    createElement(
      StatementDataProvider,
      { importId: 7 },
      createElement(DesktopAppBar, { navigation: { tabs: "story", active: "breakdown", importId: 7 } }),
    ),
  );

  test("shows the three levels by label only, on the current import", () => {
    assert.deepEqual(
      navLinks(html).map(({ href, text, current }) => ({ href, text, current })),
      [
        { href: "/overview?import=7", text: "Overview", current: false },
        { href: "/breakdown?import=7", text: "Breakdown", current: true },
        { href: "/ledger?import=7", text: "Ledger", current: false },
      ],
    );
    assert.doesNotMatch(textOf(html), /What happened|Why\?|Prove it/);
  });

  test("links Statement check to this import's analysis summary and keeps the account control", () => {
    assert.ok(links(html).some((link) => link.href === "/analysis-summary?import=7" && link.text.includes("Statement check")));
    assert.match(html, /<button[^>]*aria-label="Sign in"/);
  });

  test("names the statement without a fabricated period before the summary loads", () => {
    const text = textOf(html);
    assert.ok(text.includes("Import #7"), text);
    assert.doesNotMatch(text, /\b(19|20)\d\d\b|verified/i);
  });

  test("names the statement's format (C-15) without any verification claim or icon", () => {
    const text = textOf(html);
    assert.ok(text.includes("M-PESA statement"), text);
    assert.doesNotMatch(text, /verified|authentic|reconcil/i);
    assert.doesNotMatch(html, />verified</, "no verified icon");
  });

  test("leaves the ingest tabs untouched", () => {
    const ingest = navLinks(renderToString(createElement(DesktopAppBar, { navigation: { tabs: "ingest", active: "ingest" } })));
    assert.deepEqual(ingest.map((link) => link.href), ["/upload", "/ledger", "/breakdown/fees"]);
  });
});

describe("StoryScreen", () => {
  const html = renderToString(
    createElement(StoryScreen, { title: "Spending", navKey: "breakdown", importId: 7 }, createElement("p", null, "body")),
  );

  test("frames the screen with the story levels at both breakpoints, all on the import", () => {
    const navs = [...html.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map((m) => links(m[0]).map((link) => link.href));
    assert.deepEqual(navs, [
      ["/overview?import=7", "/breakdown?import=7", "/ledger?import=7"],
      ["/overview?import=7", "/breakdown?import=7", "/ledger?import=7"],
    ]);
    assert.match(html, /<footer\b/);
  });

  test("has one h1 per breakpoint: the mobile header's and a desktop-only one in the content", () => {
    const headings = [...html.matchAll(/<h1 class="([^"]*)">([^<]*)<\/h1>/g)].map((m) => ({ desktopOnly: m[1].includes("hidden lg:block"), text: m[2] }));
    assert.deepEqual(headings, [
      { desktopOnly: false, text: "Spending" },
      { desktopOnly: true, text: "Spending" },
    ]);
    assert.match(html, /<header class="lg:hidden[^"]*"[\s\S]*?<h1/);
  });

  test("names the import, not a period, until the summary has loaded", () => {
    assert.equal(textOf(html).match(/Import #7/g)?.length, 2);
  });
});

describe("BreakdownNav", () => {
  test("switches between the hub and the areas that have a screen, on the import", () => {
    const items = links(renderToString(createElement(BreakdownNav, { importId: 7 })));
    assert.deepEqual(
      items.map(({ href, text, current }) => ({ href, text, current })),
      [
        { href: "/breakdown?import=7", text: "All areas", current: true },
        { href: "/breakdown/spending?import=7", text: "Spending", current: false },
        { href: "/breakdown/people?import=7", text: "People", current: false },
        { href: "/breakdown/savings?import=7", text: "Savings & Investments", current: false },
        { href: "/breakdown/fees?import=7", text: "Fees", current: false },
        { href: "/breakdown/cash?import=7", text: "Cash", current: false },
        { href: "/breakdown/money-in?import=7", text: "Money In", current: false },
      ],
    );
  });
});

describe("BreakdownNav: all six areas", () => {
  const html = renderToString(createElement(BreakdownNav, { importId: 7 }));
  const entries = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner]) => ({
    text: textOf(inner.replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")).trim(),
    isLink: /<a\b/.test(inner),
  }));

  test("names the hub and the prototype's six areas, in its order", () => {
    assert.deepEqual(
      entries.map((entry) => entry.text.replace(/\s*Coming in this release$/i, "")),
      ["All areas", "Spending", "People", "Savings & Investments", "Fees", "Cash", "Money In"],
    );
  });

  // Stages 7e and 7f gave Cash and Money In their screens: no area is still to come.
  test("links every area; none is labelled coming in this release", () => {
    assert.deepEqual(entries.filter((entry) => !entry.isLink || /Coming in this release/i.test(entry.text)), []);
    assert.equal(entries.filter((entry) => entry.isLink).length, 7, "the hub and the six areas");
  });
});

describe("the interim Breakdown hub", () => {
  /** The hub as served for query `searchParams`. */
  async function renderHub(searchParams) {
    return renderToString(await BreakdownPage({ searchParams: Promise.resolve(searchParams) }));
  }

  /** The hub's content links (inside <main>), excluding the area switcher. */
  function contentLinks(html) {
    const main = html.match(/<main\b[\s\S]*?<\/main>/)[0].replace(/<nav\b[\s\S]*?<\/nav>/, "");
    return links(main);
  }

  test("opens each area's existing screen and the Ledger, keeping the import exactly once", async () => {
    const hrefs = contentLinks(await renderHub({ import: "7" })).map((link) => link.href);
    assert.deepEqual(hrefs, ["/ledger?import=7", "/breakdown/spending?import=7", "/breakdown/people?import=7", "/breakdown/savings?import=7", "/breakdown/fees?import=7", "/breakdown/cash?import=7", "/breakdown/money-in?import=7"]);
    for (const href of hrefs) assert.deepEqual(new URL(href, "https://app.test").searchParams.getAll("import"), ["7"]);
  });

  test("without an import, links to the latest import's screens", async () => {
    const hrefs = contentLinks(await renderHub({})).map((link) => link.href);
    assert.deepEqual(hrefs, ["/ledger", "/breakdown/spending", "/breakdown/people", "/breakdown/savings", "/breakdown/fees", "/breakdown/cash", "/breakdown/money-in"]);
  });

  test("an invalid import id is ignored rather than passed on", async () => {
    const hrefs = contentLinks(await renderHub({ import: "abc" })).map((link) => link.href);
    assert.ok(hrefs.every((href) => !href.includes("import")), hrefs.join(", "));
  });

  test("names no area as coming in this release once every area has a screen (Stage 7f)", async () => {
    const html = await renderHub({ import: "7" });
    assert.doesNotMatch(textOf(html), /Coming in this release/i);
  });

  test("marks Breakdown as the current level and makes no unsupported claim", async () => {
    const html = await renderHub({ import: "7" });
    for (const nav of [...html.matchAll(/<nav\b(?![^>]*aria-label="Breakdown areas")[\s\S]*?<\/nav>/g)]) {
      assert.deepEqual(links(nav[0]).filter((link) => link.current).map((link) => link.href), ["/breakdown?import=7"]);
    }
    assert.doesNotMatch(textOf(html), /reconcil|\baudit|verified|encrypt/i);
  });
});
