// Savings & Investments area cards (IA migration Stage 7d): each card renders
// the figures it is given as props (lib/statement/savings.ts), opens the
// Ledger scope of each figure, and says what the statement can't tell instead
// of guessing:
//   the header's set-aside figure and answer (deposits, places, DR-7 share of
//   money in; that share withheld alone when U-1 disagrees); T-UNVERIFIED
//   keeps the API's total, without a door (Q-D9); each place as a door to its
//   rows; months as plain figures (no month scope); the largest deposits
//   opening their receipts; charges on deposits as a door-less line counted in
//   Fees (Q-LINK); "not spending"; what the statement can't show; other
//   savings products as T-PLANNED ("Not available yet", Q-P1, Q-P2 open);
//   no export (Q-P4 deferred); a real zero.
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/savings-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { prototypeSampleWithBackendAnalytics, savingsEdgeCasesFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { savingsFigures } = await import("../src/lib/statement/savings.ts");
const { formatKes, formatMonth } = await import("../src/lib/format.ts");
const { SavingsHeader, NotSpendingNote, PlacesCard, MonthsCard, LargestDepositsCard, LimitsNote, OtherSavingsNote } = await import("../src/components/savings/savings-cards.tsx");

const IMPORT_ID = 1;
const F5 = prototypeSampleWithBackendAnalytics();
const EDGE = savingsEdgeCasesFixture();
const EMPTY = contractFixtures()["F4-paginated-2345"];

/** Savings figures of `fixture` with its rows loaded. */
function figuresOf(fixture) {
  return savingsFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) });
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

/** Every link in rendered HTML as { href, label }, entities decoded. */
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(([, attributes]) => ({
    href: (attributes.match(/href="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"),
    label: (attributes.match(/aria-label="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'"),
  }));
}

const kes = (cents) => formatKes(cents / 100);
/** The Ledger link of a Savings door, encoded as URLSearchParams encodes it. */
const door = (scopeId) => `/ledger?${new URLSearchParams({ scope: scopeId, from: "savings", import: String(IMPORT_ID) })}`;

describe("header", () => {
  test("the set-aside figure is a door to every deposit; the answer gives deposits, places and the share of money in", () => {
    const figures = figuresOf(EDGE);
    const html = render(SavingsHeader, figures);
    const shown = text(html);
    assert.match(html, /<h2[^>]*>How much did I set aside\?<\/h2>/);
    assert.ok(links(html).some((link) => link.href === door("bucket:set-aside")));
    assert.ok(shown.includes(kes(950000)));
    // The share is its own coloured span on the dark header; text() puts a space where each tag was.
    assert.ok(shown.replace(/\s+([,.])/g, "$1").includes("4 deposits into 2 places, 47.5% of the money that came in. None of it is counted as spending."), shown);
  });

  test("U-1 disagreeing: the share is withheld with R2.2's reason; the total and its door stay", () => {
    const figures = figuresOf(EDGE);
    const breakdown = { ...figures.breakdown, shareOfIn: { verified: false, share: null } };
    const html = render(SavingsHeader, { ...figures, breakdown });
    const shown = text(html);
    // Only the share of money in is withheld; the split across places (shares of the total set aside) doesn't depend on U-1.
    assert.doesNotMatch(shown, /% of the money that came in/);
    assert.match(shown, /share of the money that came in is hidden/);
    assert.ok(links(html).some((link) => link.href === door("bucket:set-aside")));
  });

  test("T-UNVERIFIED: the API's total stays, without a door, beside R2.2's wording", () => {
    const { api } = figuresOf(F5);
    const html = render(SavingsHeader, { api, breakdown: { status: "unverified" } });
    assert.ok(text(html).includes(kes(api.totalCents)));
    assert.match(text(html), /We can't confirm that this breakdown adds up/);
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });

  test("nothing set aside: a real KES 0.00, said plainly, with no door", () => {
    const html = render(SavingsHeader, figuresOf(EMPTY));
    assert.match(text(html), /You didn't set any money aside in this statement/);
    assert.ok(text(html).includes(kes(0)));
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });
});

describe("places, months and deposits", () => {
  test("each place is a door to its rows, with its share; an unidentified place is 'Not identified'", () => {
    const { breakdown } = figuresOf(EDGE);
    const html = render(PlacesCard, { places: breakdown.places });
    for (const place of breakdown.places) {
      const link = links(html).find((candidate) => candidate.href === door(place.scopeId));
      assert.ok(link, place.scopeId);
      assert.ok(text(html).includes(kes(place.cents)));
    }
    assert.match(text(html), /Not identified/);
    assert.match(text(html), /63\.2%/);
  });

  test("no places: the card says so", () => {
    assert.match(text(render(PlacesCard, { places: [] })), /No money was set aside/);
  });

  test("months: each month's total and deposits, without doors; an unreadable time is named", () => {
    const { breakdown } = figuresOf(EDGE);
    const months = [...breakdown.months, { month: null, cents: 100, count: 1 }];
    const html = render(MonthsCard, { months });
    const shown = text(html);
    assert.ok(shown.includes(formatMonth("2026-08")) && shown.includes(formatMonth("2026-09")), shown);
    assert.ok(shown.includes(kes(550000)) && shown.includes("2 deposits"));
    assert.match(shown, /Time not readable/);
    assert.deepEqual(links(html), []);
  });

  test("largest deposits open their receipts; the exit opens every deposit; charges are a door-less line linking Fees", () => {
    const { breakdown } = figuresOf(EDGE);
    const html = render(LargestDepositsCard, { deposits: breakdown.deposits, depositCount: breakdown.total.count, depositCharges: breakdown.depositCharges });
    for (const deposit of breakdown.deposits) assert.ok(links(html).some((link) => link.href === door(deposit.scopeId)), deposit.receiptNo);
    assert.ok(links(html).some((link) => link.href === door("bucket:set-aside")));
    assert.ok(text(html).includes("See all 4 deposits in Ledger"));
    assert.match(text(html), /No charges were linked to your deposits/);
    assert.ok(links(html).some((link) => link.href === `/breakdown/fees?import=${IMPORT_ID}`));
    const charged = render(LargestDepositsCard, { deposits: breakdown.deposits, depositCount: 4, depositCharges: { cents: 3300, count: 1 } });
    assert.ok(text(charged).includes(`Deposits carried ${kes(3300)} in charges across 1 deposit`));
  });
});

describe("notes", () => {
  test("set aside isn't spending", () => {
    assert.match(text(render(NotSpendingNote, {})), /never counted as Spending/);
  });

  test("what the statement can't show: balances and growth; only unit-trust deposits are recognised", () => {
    const shown = text(render(LimitsNote, {}));
    assert.match(shown, /Balances, growth and withdrawals/);
    assert.match(shown, /unit-trust deposits/);
  });

  test("other savings products are T-PLANNED: 'Not available yet', no figure, no link", () => {
    const html = render(OtherSavingsNote, {});
    assert.match(text(html), /Not available yet/);
    assert.doesNotMatch(text(html), /KES/);
    assert.deepEqual(links(html), []);
  });
});
