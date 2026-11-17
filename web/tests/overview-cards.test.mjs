// Overview cards (IA migration Stage 6): each card renders the figures it is
// given as props (lib/statement/overview.ts), opens the Ledger scope of each
// figure, and states what it cannot show instead of showing a made-up value:
//   the bridge's O1 with its O2 check (Q-D6), agreeing, mismatching or not
//   checked; T-UNVERIFIED breakdowns (Q-D9); "From businesses" as T-PLANNED
//   (M-07, M-26; Q-P1 label), never counted; zero inflow, negative and zero
//   net flow, zero unclassified rows and long names (stress statement).
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/overview-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { prototypeSampleWithBackendAnalytics, stressOverviewFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { overviewFigures } = await import("../src/lib/statement/overview.ts");
const { formatKes } = await import("../src/lib/format.ts");
const { StoryCard } = await import("../src/components/overview/story-card.tsx");
const { CashFlowBridgeCard } = await import("../src/components/overview/cash-flow-bridge-card.tsx");
const { OutflowAllocationCard } = await import("../src/components/overview/outflow-allocation-card.tsx");
const { WhereFromCard } = await import("../src/components/overview/where-from-card.tsx");
const { ReviewStatusCard } = await import("../src/components/overview/review-status-card.tsx");
const { KeyEventsCard } = await import("../src/components/overview/key-events-card.tsx");

const IMPORT_ID = 1;
const F5 = prototypeSampleWithBackendAnalytics();
const STRESS = stressOverviewFixture();

/** Overview figures of `fixture` (rows loaded), optionally with altered analytics or summary. */
function figuresOf(fixture, { analytics = fixture.snapshot.result, summary = fixture.summary } = {}) {
  return overviewFigures({ summary, analytics, rows: fixture.rows.map(toStatementRow) });
}

/** Render `component` with `props` and the import id. */
function render(component, props) {
  return renderToString(createElement(component, { importId: IMPORT_ID, ...props }));
}

/** The visible text of rendered HTML: tags dropped, entities decoded, whitespace collapsed. */
function text(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Every href in rendered HTML, entities decoded. */
function hrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
}

const kes = (cents) => formatKes(cents / 100);
const door = (scopeId) => `/ledger?scope=${encodeURIComponent(scopeId)}&from=overview&import=${IMPORT_ID}`;

describe("story card", () => {
  test("money in and out are doors to their scopes; closing and statement lines from the API", () => {
    const figures = figuresOf(F5);
    const html = render(StoryCard, { period: "1 Jul 2024 – 31 Jul 2024", figures });
    const shown = text(html);
    for (const cents of [figures.moneyIn.cents, figures.moneyOut.cents, figures.closingCents]) assert.ok(shown.includes(kes(cents)), kes(cents));
    assert.ok(shown.includes("1 Jul 2024 – 31 Jul 2024"));
    assert.ok(shown.includes(`${figures.lineCount} statement lines`), shown);
    assert.ok(hrefs(html).includes(door("money-in")) && hrefs(html).includes(door("money-out")), hrefs(html).join(" "));
  });

  test("a negative net flow reads as lower, a zero one as unchanged, never as higher", () => {
    const negative = text(render(StoryCard, { period: "p", figures: figuresOf(STRESS) }));
    assert.match(negative, new RegExp(`${kes(71169_00).replace(/[.]/g, "\\.")} lower`));
    assert.doesNotMatch(negative, /higher/);
    const zero = { ...figuresOf(F5), netCents: 0 };
    assert.match(text(render(StoryCard, { period: "p", figures: zero })), /the same balance it started with/);
  });
});

describe("cash-flow bridge (Q-D6)", () => {
  const flow = F5.snapshot.result.cash_flow;

  test("agreeing: O1 labelled calculated, no mismatch note; in, out and closing as the API states them", () => {
    const figures = figuresOf(F5);
    const shown = text(render(CashFlowBridgeCard, { figures }));
    assert.ok(shown.includes("Opening balance (calculated)"));
    assert.ok(shown.includes(kes(figures.bridge.opening.o1Cents)));
    for (const cents of [figures.moneyIn.cents, figures.moneyOut.cents, figures.closingCents]) assert.ok(shown.includes(kes(cents)), kes(cents));
    assert.doesNotMatch(shown, /can't confirm|couldn't be checked/i);
  });

  test("mismatching: the opening value is withheld and the note gives both values (T-UNVERIFIED)", () => {
    const analytics = structuredClone(F5.snapshot.result);
    analytics.cash_flow.closing_balance = flow.closing_balance + 50;
    const figures = figuresOf(F5, { analytics });
    const { o1Cents, o2 } = figures.bridge.opening;
    const html = render(CashFlowBridgeCard, { figures });
    const shown = text(html);
    assert.match(shown, /can't confirm the opening balance/i);
    assert.ok(shown.includes(kes(o1Cents)) && shown.includes(kes(o2.cents)), shown);
    assert.match(html, /data-opening-withheld/);
    assert.doesNotMatch(shown, /statement is wrong|error in your statement/i);
  });

  test("not checked: O1 shown, and the note says why the rows can't check it", () => {
    const figures = figuresOf(F5);
    const tied = { ...figures, bridge: { opening: { ...figures.bridge.opening, o2: { status: "unavailable", reason: "tied-earliest-time" }, check: "not-checked" } } };
    const shown = text(render(CashFlowBridgeCard, { figures: tied }));
    assert.ok(shown.includes(kes(figures.bridge.opening.o1Cents)));
    assert.match(shown, /couldn't be checked.*share the earliest time/i);
  });
});

describe("outflow allocation", () => {
  test("every bucket with its amount, DR-7 share and bucket scope; the total is money out", () => {
    const figures = figuresOf(F5);
    const html = render(OutflowAllocationCard, { allocation: figures.allocation, moneyOutCents: figures.moneyOut.cents });
    const shown = text(html);
    assert.ok(shown.includes(kes(figures.moneyOut.cents)));
    for (const item of figures.allocation.items) {
      assert.ok(shown.includes(kes(item.cents)), item.bucket);
      assert.ok(shown.includes(`${item.share.toFixed(1)}%`), `${item.bucket} ${item.share}`);
      assert.ok(hrefs(html).includes(door(item.scopeId)), item.scopeId);
    }
    assert.ok(hrefs(html).includes(`/breakdown?import=${IMPORT_ID}`));
  });

  test("T-UNVERIFIED: no bucket figures, R2.2's wording, and the API total stays", () => {
    const shown = text(render(OutflowAllocationCard, { allocation: { status: "unverified" }, moneyOutCents: 1234500 }));
    assert.match(shown, /We can't confirm that this breakdown adds up to the totals calculated when your statement was imported, so it's hidden\. The totals shown come directly from your import\./);
    assert.ok(shown.includes(kes(1234500)));
    assert.doesNotMatch(shown, /%/);
  });
});

describe("where it came from", () => {
  test("sources with shares and scopes; From businesses is T-PLANNED: labelled, no figure, not linked", () => {
    const figures = figuresOf(F5);
    const html = render(WhereFromCard, { sources: figures.sources, moneyInCents: figures.moneyIn.cents });
    const shown = text(html);
    for (const item of figures.sources.items) {
      assert.ok(shown.includes(kes(item.cents)), item.bucket);
      assert.ok(hrefs(html).includes(door(item.scopeId)), item.scopeId);
    }
    assert.match(shown, /From businesses Not available yet/);
    const businessRow = html.match(/<[^>]*data-planned=""[^>]*>[\s\S]*?From businesses[\s\S]*?Not available yet/);
    assert.ok(businessRow, "the business line is marked planned");
    assert.doesNotMatch(businessRow[0], /href=|KES/);
  });

  test("the exit opens the Money In area on the import (Stage 7f)", () => {
    const figures = figuresOf(F5);
    const html = render(WhereFromCard, { sources: figures.sources, moneyInCents: figures.moneyIn.cents });
    assert.ok(hrefs(html).includes(`/breakdown/money-in?import=${IMPORT_ID}`));
    assert.doesNotMatch(text(html), /coming in this release/i);
  });

  test("zero inflow: a real KES 0.00, no sources and no share", () => {
    const figures = figuresOf(STRESS);
    const shown = text(render(WhereFromCard, { sources: figures.sources, moneyInCents: 0 }));
    assert.ok(shown.includes(kes(0)));
    assert.match(shown, /No money came in/);
    assert.doesNotMatch(shown, /%/);
  });
});

describe("review status", () => {
  test("unclassified rows: the API count, the rows' amounts per direction, and their scope", () => {
    const figures = figuresOf(F5);
    const html = render(ReviewStatusCard, { review: figures.review, lineCount: figures.lineCount });
    const shown = text(html);
    assert.ok(shown.includes(`${figures.review.apiCount} statement lines`), shown);
    if (figures.review.rows.inCents) assert.ok(shown.includes(kes(figures.review.rows.inCents)));
    if (figures.review.rows.outCents) assert.ok(shown.includes(kes(figures.review.rows.outCents)));
    assert.ok(hrefs(html).includes(door("unclassified")));
  });

  test("nothing unclassified: says so, with no door to an empty scope", () => {
    const figures = figuresOf(STRESS);
    const html = render(ReviewStatusCard, { review: figures.review, lineCount: figures.lineCount });
    assert.match(text(html), /Every statement line was classified/);
    assert.ok(!hrefs(html).some((href) => href.includes("scope=unclassified")));
  });

  test("U-5: a different stored count is explained, and the import's count still shown", () => {
    const summary = { ...F5.summary, unclassified_transaction_count: F5.summary.unclassified_transaction_count + 2 };
    const figures = figuresOf(F5, { summary });
    const shown = text(render(ReviewStatusCard, { review: figures.review, lineCount: figures.lineCount }));
    assert.ok(shown.includes(`${summary.unclassified_transaction_count} statement lines`));
    assert.match(shown, /stored once/);
  });
});

describe("largest transactions (Q-D4)", () => {
  test("API purchases labelled incl. charges; the rows' largest inflow and send with their charge; each opens its receipt", () => {
    const figures = figuresOf(F5);
    const html = render(KeyEventsCard, { largest: figures.largest, lineCount: figures.lineCount });
    const shown = text(html);
    assert.match(shown, /Largest transactions/);
    for (const event of [...figures.largest.purchases, ...figures.largest.derived]) {
      assert.ok(shown.includes(kes(event.cents)), event.receiptNo);
      assert.ok(hrefs(html).includes(door(event.scopeId)), event.scopeId);
    }
    assert.equal((shown.match(/incl\. charges/g) ?? []).length, figures.largest.purchases.length);
    for (const event of figures.largest.derived.filter((e) => e.chargeCents > 0)) assert.ok(shown.includes(`+ ${kes(event.chargeCents)} charge`));
    assert.ok(hrefs(html).includes(`/ledger?from=overview&import=${IMPORT_ID}`));
  });

  test("long names render whole in the markup, truncated only by style", () => {
    const figures = figuresOf(STRESS);
    const html = render(KeyEventsCard, { largest: figures.largest, lineCount: figures.lineCount });
    assert.ok(text(html).includes(figures.largest.purchases[0].entity));
    assert.match(html, /truncate/);
  });
});
