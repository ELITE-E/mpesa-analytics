// Fees area cards (IA migration Stage 7c): each card renders the figures it
// is given as props (lib/statement/fees.ts), opens the Ledger scope of each
// figure, and says what the statement can't tell instead of guessing:
//   the header's charges paid (the API's) as a door to every charge, an
//   answer with the payments charged and the share of money out (withheld
//   alone when U-2 disagrees), and the unlinked disclosure (rev2 R1.2);
//   T-UNVERIFIED and T-LOADFAIL keep the API's total without a door (Q-D9);
//   each cause (Q-D7) as a door to its charges, with the areas they belong to
//   linked; the largest charges opening their receipts; charges are counted
//   once; payments without a charge; excise duty isn't split out; a real zero.
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/fees-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { prototypeSampleWithBackendAnalytics } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { feesFigures } = await import("../src/lib/statement/fees.ts");
const { formatKes } = await import("../src/lib/format.ts");
const { FeesHeader, CausesCard, LargestChargesCard, CountedOnceNote, FreeNote, ExciseNote } = await import("../src/components/fees/fees-area-cards.tsx");

const IMPORT_ID = 1;
const F5 = prototypeSampleWithBackendAnalytics();
const F1 = contractFixtures()["F1-worked-example"];
const NO_FEES = contractFixtures()["F4-paginated-2345"];

/** Fees figures of `fixture` with its rows loaded. */
function figuresOf(fixture) {
  return feesFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) });
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
/** The Ledger link of a Fees door, encoded as URLSearchParams encodes it. */
const door = (scopeId) => `/ledger?${new URLSearchParams({ scope: scopeId, from: "fees", import: String(IMPORT_ID) })}`;

describe("header", () => {
  test("charges paid is a door to every charge; the answer gives the payments charged and the share of money out", () => {
    const figures = figuresOf(F5);
    const { breakdown } = figures;
    const html = render(FeesHeader, figures);
    const shown = text(html);
    assert.match(html, /<h2[^>]*>What did moving my money cost\?<\/h2>/);
    assert.deepEqual(links(html).map((link) => link.href), [`/breakdown?import=${IMPORT_ID}`, door("fees")]);
    assert.ok(shown.includes(kes(53200)));
    // The share is its own coloured span on the dark header; text() puts a space where each tag was.
    assert.ok(shown.replace(/\s+([,.])/g, "$1").includes(`${breakdown.total.count} charges on ${breakdown.chargedPayments} of your ${breakdown.paymentsOut} payments out, 0.4% of money out.`), shown);
    assert.doesNotMatch(shown, /couldn't be tied/);
  });

  test("unlinked charges are disclosed (rev2 R1.2)", () => {
    assert.match(text(render(FeesHeader, figuresOf(F1))), /2 charges couldn't be tied to one transaction; they're listed on their own\./);
  });

  test("U-2 disagreeing: the share is withheld with its reason; the total and its door stay", () => {
    const figures = figuresOf(F5);
    const html = render(FeesHeader, { ...figures, breakdown: { ...figures.breakdown, shareOfOut: { verified: false, share: null } } });
    assert.doesNotMatch(text(html), /%/);
    assert.match(text(html), /share of money out is hidden/);
    assert.ok(links(html).some((link) => link.href === door("fees")));
  });

  test("T-UNVERIFIED and T-LOADFAIL: the API's total stays, without a door", () => {
    const { api } = figuresOf(F5);
    for (const breakdown of [{ status: "unverified" }, null]) {
      const html = render(FeesHeader, { api, breakdown });
      assert.ok(text(html).includes(kes(api.cents)));
      assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
      if (breakdown) assert.match(text(html), /We can't confirm that this breakdown adds up/);
    }
  });

  test("no charges: a real KES 0.00, said plainly, with no door", () => {
    const html = render(FeesHeader, figuresOf(NO_FEES));
    assert.match(text(html), /No charges in this statement/);
    assert.ok(text(html).includes(kes(0)));
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });
});

describe("causes and largest charges", () => {
  test("each cause is a door to its charges with its count and share, and no other amount on it; unlinked named; areas linked", () => {
    const { breakdown } = figuresOf(F1);
    const html = render(CausesCard, { causes: breakdown.causes });
    for (const cause of breakdown.causes) assert.ok(links(html).some((link) => link.href === door(cause.scopeId)), cause.scopeId);
    const shown = text(html);
    for (const label of ["Paybill payments", "Cash withdrawals", "Sending money", "Charges not linked to one transaction"]) assert.ok(shown.includes(label), label);
    assert.match(shown, /2 charges/);
    assert.doesNotMatch(shown, /avg/);
    const areas = links(html).filter((link) => link.href.startsWith("/breakdown/")).map((link) => link.href);
    assert.deepEqual(areas, [`/breakdown/spending?import=${IMPORT_ID}`, `/breakdown/cash?import=${IMPORT_ID}`, `/breakdown/people?import=${IMPORT_ID}`]);
  });

  test("no causes: the card says so", () => {
    assert.match(text(render(CausesCard, { causes: [] })), /No charges in this statement/);
  });

  test("largest charges open their receipts with their cause and the payment they were for; unlinked ones say so", () => {
    const { breakdown } = figuresOf(F1);
    const html = render(LargestChargesCard, { charges: breakdown.largest, chargeCount: breakdown.total.count });
    for (const charge of breakdown.largest) assert.ok(links(html).some((link) => link.href === door(charge.scopeId)), charge.receiptNo);
    const shown = text(html);
    assert.ok(shown.includes(`${kes(3000)}`) && shown.includes(`on ${kes(200000)}`), shown);
    assert.match(shown, /Not linked to one transaction/);
    assert.ok(links(html).some((link) => link.href === door("fees")));
    assert.ok(shown.includes(`See all ${breakdown.total.count} charges in Ledger`));
  });
});

describe("notes", () => {
  test("charges are counted once, here", () => {
    assert.match(text(render(CountedOnceNote, {})), /counted once/i);
  });

  test("payments without a charge, out and in; no doors", () => {
    const html = render(FreeNote, { free: { outCount: 12, inCount: 5 } });
    assert.match(text(html), /12 payments out and 5 payments in carried no charge/);
    assert.deepEqual(links(html), []);
  });

  test("excise duty isn't split out on the statement", () => {
    assert.match(text(render(ExciseNote, {})), /excise duty/i);
  });
});
