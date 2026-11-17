// People area cards (IA migration Stage 7b): each card renders the figures it
// is given as props (lib/statement/people.ts), opens the Ledger scope of each
// figure, and says what the statement can't tell instead of guessing:
//   the header's sent figure and answer (net both ways, worded by its sign);
//   T-UNVERIFIED keeps the API's totals, without doors (Q-D9); each person's
//   sent and received as named doors to their rows in that direction; the
//   unidentified recipient as "Not identified"; the largest sends; charges on
//   sends as a door-less line counted in Fees (Q-LINK); the honest "purpose"
//   note; own-account transfers as T-PLANNED ("Not available yet", Q-P1);
//   received money linked to Money In (its screen since Stage 7f); a real zero.
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/people-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { peopleEdgeCasesFixture, prototypeSampleWithBackendAnalytics } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { peopleFigures } = await import("../src/lib/statement/people.ts");
const { formatKes } = await import("../src/lib/format.ts");
const cards = await import("../src/components/people/people-cards.tsx");
const { PeopleHeader, PurposeNote, PeopleListCard, LargestSendsCard, DirectionsCard, SendCostCard, OwnTransferNote } = cards;

const IMPORT_ID = 1;
const F5 = prototypeSampleWithBackendAnalytics();
const EDGE = peopleEdgeCasesFixture();
const EMPTY = contractFixtures()["F4-paginated-2345"];

/** People figures of `fixture` with its rows loaded. */
function figuresOf(fixture) {
  return peopleFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) });
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
/** The Ledger link of a People door, encoded as URLSearchParams encodes it. */
const door = (scopeId) => `/ledger?${new URLSearchParams({ scope: scopeId, from: "people", import: String(IMPORT_ID) })}`;

describe("header", () => {
  test("the API's sent figure is a door to everything sent; the answer gives both directions and the net", () => {
    const figures = figuresOf(F5);
    const { breakdown } = figures;
    const html = render(PeopleHeader, figures);
    const shown = text(html);
    assert.match(html, /<h2[^>]*>How much money moved between me and other people\?<\/h2>/);
    assert.ok(links(html).some((link) => link.href === door("bucket:sent-to-people")));
    assert.ok(shown.includes(`You sent ${kes(breakdown.sent.cents)} to ${breakdown.sent.people} people and received ${kes(breakdown.received.cents)} from ${breakdown.received.people}.`), shown);
    const net = breakdown.netCents;
    assert.ok(shown.includes(net >= 0 ? `people sent you ${kes(net)} more than you sent them` : `you sent people ${kes(-net)} more than they sent you`), shown);
  });

  test("the net is worded by its sign: more sent than received reads that way round", () => {
    const figures = figuresOf(EDGE);
    assert.ok(figures.breakdown.netCents > 0);
    const negative = { ...figures, breakdown: { ...figures.breakdown, netCents: -500 } };
    assert.match(text(render(PeopleHeader, negative)), /you sent people KES 5\.00 more than they sent you/);
    const zero = { ...figures, breakdown: { ...figures.breakdown, netCents: 0 } };
    assert.match(text(render(PeopleHeader, zero)), /as much as you sent them/);
  });

  test("T-UNVERIFIED: the API's totals stay, without doors, beside R2.2's wording", () => {
    const { api } = figuresOf(F5);
    const html = render(PeopleHeader, { api, breakdown: { status: "unverified" } });
    const shown = text(html);
    assert.ok(shown.includes(kes(api.sentCents)) && shown.includes(kes(api.receivedCents)));
    assert.match(shown, /We can't confirm that this breakdown adds up to the totals calculated when your statement was imported/);
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });

  test("no transfers: a real KES 0.00 both ways, said plainly, with no door", () => {
    const figures = figuresOf(EMPTY);
    const html = render(PeopleHeader, figures);
    assert.match(text(html), /No money moved between you and other people/);
    assert.ok(text(html).includes(kes(0)));
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });
});

describe("people", () => {
  test("each person's sent and received are named doors to their rows in that direction; '—' where none", () => {
    const { breakdown } = figuresOf(EDGE);
    const html = render(PeopleListCard, { people: breakdown.people });
    const all = links(html);
    for (const person of breakdown.people) {
      for (const [direction, figure] of [["Sent to", person.sent], ["Received from", person.received]]) {
        if (!figure) continue;
        const link = all.find((candidate) => candidate.href === door(figure.scopeId));
        assert.ok(link, figure.scopeId);
        assert.equal(link.label, `${direction} ${person.label}: ${kes(figure.cents)}, see the rows`);
      }
    }
    const shown = text(html);
    assert.ok(shown.includes("Mary Wanjiku") && shown.includes("MARY WANJIKU"), "two spellings, two people");
    assert.match(shown, /Not identified/);
    assert.match(shown, /two spellings/);
    assert.match(html, /truncate/);
  });

  test("no people: the list says so", () => {
    assert.match(text(render(PeopleListCard, { people: [] })), /No money moved between you and other people/);
  });
});

describe("sends, directions and charges", () => {
  test("largest sends open their receipts with their charge; the exit opens every send", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(LargestSendsCard, { sends: breakdown.largestSends, sendCount: breakdown.sent.count });
    for (const send of breakdown.largestSends) {
      assert.ok(links(html).some((link) => link.href === door(send.scopeId)), send.receiptNo);
      assert.ok(text(html).includes(kes(send.cents)));
      if (send.chargeCents) assert.ok(text(html).includes(`+ ${kes(send.chargeCents)} charge`));
    }
    assert.ok(links(html).some((link) => link.href === door("bucket:sent-to-people")));
    assert.ok(text(html).includes(`See all ${breakdown.sent.count} sends in Ledger`));
  });

  test("both directions: two doors; received is part of Money In, linked to its screen on the import (Stage 7f)", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(DirectionsCard, { breakdown });
    assert.ok(links(html).some((link) => link.href === door("bucket:sent-to-people")));
    assert.ok(links(html).some((link) => link.href === door("bucket:from-people")));
    assert.match(text(html), /also part of Money In/);
    assert.ok(links(html).some((link) => link.href === `/breakdown/money-in?import=${IMPORT_ID}`));
  });

  test("charges on sends: display only, counted once in Fees, with a link to the Fees screen", () => {
    const { breakdown } = figuresOf(F5);
    assert.ok(breakdown.sendCharges.cents > 0);
    const html = render(SendCostCard, { sendCharges: breakdown.sendCharges });
    assert.ok(text(html).includes(`${kes(breakdown.sendCharges.cents)} in charges across ${breakdown.sendCharges.count} sends`), text(html));
    assert.deepEqual(links(html).map((link) => link.href), [`/breakdown/fees?import=${IMPORT_ID}`]);
  });
});

describe("notes", () => {
  test("the statement can't say what sends were for", () => {
    const shown = text(render(PurposeNote, {}));
    assert.match(shown, /can't tell what these payments were for/);
    assert.match(shown, /TRANSFER_OUT/);
  });

  test("own-account transfers are T-PLANNED: labelled 'Not available yet', no figure, no link", () => {
    const html = render(OwnTransferNote, {});
    assert.match(text(html), /Not the same as a transfer/);
    assert.match(text(html), /Not available yet/);
    assert.doesNotMatch(text(html), /KES/);
    assert.deepEqual(links(html), []);
  });
});
