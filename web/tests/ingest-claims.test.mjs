// Claims gate for the ingest screens (Stage 1 of the IA migration, claims
// register C-01…C-09 and C-23): the welcome, upload, processing and analysis
// summary screens, and the ingest header and tab bar, must not tell users
// anything the application does not do.
//
//   - No reconciliation or audit is performed (nothing in src/ reconciles a
//     statement against another source).
//   - Transport encryption depends on how the app is served (local
//     development is plain http), so it is not claimed (decision Q-C1).
//   - The statement's verification code is read, not validated.
//   - The Vault tab had no screen; it is removed until it exists (Q-P1).
//
// Screens are rendered with the real page and component modules. Copy that
// only appears after client-side state changes (the processing stages, which
// need a pending upload; the analysis summary, which needs a loaded import) is
// checked through the same module or component that renders it.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/ingest-claims.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Browser globals the client modules touch, set before the app is imported.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.app.test";
globalThis.window = {
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: new URL("https://app.test/"),
};

const { default: WelcomePage } = await import("../src/app/page.tsx");
const { default: UploadPage } = await import("../src/app/upload/page.tsx");
const { default: ProcessingPage } = await import("../src/app/processing/page.tsx");
const { default: AnalysisSummaryPage } = await import("../src/app/analysis-summary/page.tsx");
const { stages } = await import("../src/content/processing.ts");
const { SummaryHero } = await import("../src/components/analysis-summary/summary-hero.tsx");
const { CashFlowSnapshotCard } = await import(
  "../src/components/analysis-summary/cash-flow-snapshot-card.tsx"
);
const { describeImport } = await import(
  "../src/components/analysis-summary/analysis-summary-view.tsx"
);

/** Unsupported claims, each with the reason it is unsupported. */
const BANNED_CLAIMS = [
  { pattern: /reconcil/i, reason: "no reconciliation is performed" },
  { pattern: /\baudit/i, reason: "no audit is performed" },
  { pattern: /encrypted in transit|https/i, reason: "transport encryption is not claimed (Q-C1)" },
  { pattern: /verification code checked/i, reason: "the verification code is read, not validated" },
  { pattern: /\bvault\b/i, reason: "the Vault feature does not exist (Q-P1)" },
];

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

const CASH_FLOW = { total_inflow: 100, total_outflow: 60, net_cash_flow: 40, closing_balance: 40 };

/** Decode the HTML entities renderToString emits for text and attributes. */
function decodeEntities(text) {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The text a user can perceive in server-rendered markup: element text plus
 * the accessible-name and alternative-text attributes. Class names, hrefs and
 * other attributes are excluded so styling tokens cannot match a claim.
 */
function userFacingText(html) {
  const labels = [...html.matchAll(/\s(?:aria-label|alt|title)="([^"]*)"/g)].map((m) => m[1]);
  const text = html.replace(/<[^>]*>/g, " ");
  return decodeEntities([text, ...labels].join(" ")).replace(/\s+/g, " ");
}

/** Render a server or client component tree to user-facing text. */
async function renderText(element) {
  return userFacingText(renderToString(await element));
}

/** Fail with every banned claim found in `text`, naming where it was found. */
function assertNoBannedClaims(text, where) {
  const found = BANNED_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
    ({ pattern, reason }) => `${text.match(pattern)[0]} (${reason})`,
  );
  assert.deepEqual(found, [], `${where} shows unsupported claims`);
}

describe("ingest screens make no unsupported claims", () => {
  test("welcome screen", async () => {
    const text = await renderText(WelcomePage());
    assertNoBannedClaims(text, "/");
    assert.match(text, /Private to your account/i);
  });

  test("upload screen", async () => {
    const text = await renderText(UploadPage());
    assertNoBannedClaims(text, "/upload");
    // The verified storage claim (C-06, C-24) is kept.
    assert.match(text, /The PDF and its password are never stored/);
  });

  test("processing screen", async () => {
    assertNoBannedClaims(await renderText(ProcessingPage()), "/processing");
  });

  test("processing stages, shown while an upload is in flight", () => {
    const text = stages.map((stage) => `${stage.title} ${stage.detail} ${stage.doneLabel}`).join(" ");
    assertNoBannedClaims(text, "processing stages");
    assert.match(text, /verification code read from the statement/);
  });

  test("analysis summary screen frame", async () => {
    const page = AnalysisSummaryPage({ searchParams: Promise.resolve({ import: "7" }) });
    assertNoBannedClaims(await renderText(page), "/analysis-summary");
  });

  test("analysis summary for a loaded import", async () => {
    const description = describeImport({ summary: SUMMARY });
    const hero = createElement(SummaryHero, { description, verificationCode: null });
    const snapshot = createElement(CashFlowSnapshotCard, {
      period: "Period: Jul 1 – Jul 31, 2026",
      itemCount: "12 Items",
      cashFlow: CASH_FLOW,
      overviewHref: "/overview?import=7",
    });
    const text = await renderText(createElement("div", null, hero, snapshot));
    assertNoBannedClaims(text, "/analysis-summary (loaded)");
    assert.match(description, /has been imported and saved to your account\./);
  });
});

describe("ingest tab bar", () => {
  test("every tab links to a screen; there is no Vault placeholder", async () => {
    const html = renderToString(await UploadPage());
    const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)[0];
    const hrefs = [...nav.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ["/upload", "/ledger", "/breakdown/fees"]);
  });
});
