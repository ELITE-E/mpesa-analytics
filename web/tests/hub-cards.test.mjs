// Breakdown hub cards (IA migration Stage 8a): each card renders the figures
// it is given as props (lib/statement/hub.ts) and opens the Ledger scope of
// each figure:
//   the header's money out and in, doors only when verified (U-1 to U-3);
//   each area card's figure, share of money out and "Open" link, a real zero
//   said plainly, and only the question and link while figures load or are
//   withheld; the "adds up" card listing every outflow bucket with money,
//   supported by an area or not, each a door, adding up to money out, with
//   the note on payments not recognised yet; T-UNVERIFIED with R2.2's wording.
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/hub-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { prototypeSampleWithBackendAnalytics } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { hubFigures } = await import("../src/lib/statement/hub.ts");
const { formatKes } = await import("../src/lib/format.ts");
const { BREAKDOWN_AREAS } = await import("../src/content/breakdown.ts");
const { HubHeader, AreaCard, AddsUpCard } = await import("../src/components/breakdown/hub-cards.tsx");

const IMPORT_ID = 1;
const F5 = prototypeSampleWithBackendAnalytics();
const F1 = contractFixtures()["F1-worked-example"];

/** Hub figures of `fixture` with its rows loaded. */
function figuresOf(fixture) {
  return hubFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) });
}

/** Render `component` with `props` and the import id. */
function render(component, props) {
  return renderToString(createElement(component, { importId: IMPORT_ID, ...props }));
}

/** The visible text of rendered HTML: icon ligatures (aria-hidden) and tags dropped, entities decoded, whitespace collapsed. */
function text(html) {
  return html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Every link's href in rendered HTML, entities decoded. */
function hrefs(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href.replace(/&amp;/g, "&"));
}

const kes = (cents) => formatKes(cents / 100);
/** The Ledger link of a hub door, encoded as URLSearchParams encodes it. */
const door = (scopeId) => `/ledger?${new URLSearchParams({ scope: scopeId, from: "breakdown", import: String(IMPORT_ID) })}`;
const area = (id) => BREAKDOWN_AREAS.find((entry) => entry.id === id);

describe("header", () => {
  test("money out and money in, each a door when verified; the Ledger is one tap away", () => {
    const figures = figuresOf(F5);
    const html = render(HubHeader, { figures });
    assert.match(html, /<h2[^>]*>Why did my money move the way it did\?<\/h2>/);
    assert.ok(text(html).includes(`${kes(figures.moneyOut.cents)} went out and ${kes(figures.moneyIn.cents)} came in.`), text(html));
    assert.deepEqual(hrefs(html).filter((href) => href.includes("scope=")), [door("money-out"), door("money-in")]);
    assert.ok(hrefs(html).includes(`/ledger?import=${IMPORT_ID}`));
  });

  test("withheld (T-UNVERIFIED) or loading (no rows): the API's totals stay, without doors; while the import loads, no figures", () => {
    const figures = figuresOf(F5);
    for (const breakdown of [{ status: "unverified" }, null]) {
      const html = render(HubHeader, { figures: { ...figures, breakdown } });
      assert.ok(text(html).includes(kes(figures.moneyOut.cents)));
      assert.ok(!hrefs(html).some((href) => href.includes("scope=")));
    }
    const loading = render(HubHeader, { figures: null });
    assert.doesNotMatch(text(loading), /KES/);
    assert.ok(hrefs(loading).includes(`/ledger?import=${IMPORT_ID}`));
  });

  test("money in without U-1: no money-in door", () => {
    const figures = figuresOf(F5);
    const html = render(HubHeader, { figures: { ...figures, breakdown: { ...figures.breakdown, inflowVerified: false } } });
    assert.deepEqual(hrefs(html).filter((href) => href.includes("scope=")), [door("money-out")]);
  });
});

describe("area cards", () => {
  test("an area's figure is a door to its bucket, with its share of money out, and opens its screen", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(AreaCard, { area: area("spending"), figure: breakdown.areas.spending });
    assert.ok(hrefs(html).includes(door("bucket:spending")));
    assert.ok(text(html).includes(kes(breakdown.areas.spending.cents)));
    assert.match(text(html), /64\.5% of money out/);
    assert.ok(hrefs(html).includes(`/breakdown/spending?import=${IMPORT_ID}`));
  });

  test("an area with no rows: a real KES 0.00 said plainly, no door, still opens its screen", () => {
    const html = render(AreaCard, { area: area("savings"), figure: { cents: 0, count: 0, share: 0, scopeId: "bucket:set-aside" } });
    assert.match(text(html), /KES 0\.00 None in this statement/);
    assert.ok(!hrefs(html).some((href) => href.startsWith("/ledger")));
    assert.ok(hrefs(html).includes(`/breakdown/savings?import=${IMPORT_ID}`));
  });

  test("figures loading or withheld: the question and the link only", () => {
    const html = render(AreaCard, { area: area("cash"), figure: null });
    assert.doesNotMatch(text(html), /KES/);
    assert.deepEqual(hrefs(html), [`/breakdown/cash?import=${IMPORT_ID}`]);
  });
});

describe("how the parts add up", () => {
  test("every outflow bucket with money, supported by an area or not, each a door; the total is money out", () => {
    const figures = figuresOf(F1);
    const html = render(AddsUpCard, { breakdown: figures.breakdown, moneyOut: figures.moneyOut });
    for (const part of figures.breakdown.parts) {
      assert.ok(hrefs(html).includes(door(part.scopeId)), part.scopeId);
      assert.ok(text(html).includes(kes(part.cents)), part.bucket);
    }
    for (const label of ["Not yet classified", "Airtime", "Reversals (money out)"]) assert.ok(text(html).includes(label), label);
    assert.ok(hrefs(html).includes(door("money-out")));
    assert.match(text(html), /Money out KES [0-9,.]+/);
    assert.match(text(html), /Fuliza/);
  });

  test("T-UNVERIFIED: R2.2's wording, no parts, no doors", () => {
    const html = render(AddsUpCard, { breakdown: { status: "unverified" }, moneyOut: figuresOf(F5).moneyOut });
    assert.match(text(html), /We can't confirm that this breakdown adds up/);
    assert.ok(!hrefs(html).some((href) => href.startsWith("/ledger")));
  });
});
