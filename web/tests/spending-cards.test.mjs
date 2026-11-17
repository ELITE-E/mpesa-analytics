// Spending area cards (IA migration Stage 7a): each card renders the figures
// it is given as props (lib/statement/spending.ts), opens the Ledger scope of
// each figure, and says what it cannot show instead of inventing it:
//   the principal headline with its linked charges as a secondary,
//   door-less line (Q-D1) and the T-DERIVED note; airtime listed as not
//   counted (Q-D2); T-UNVERIFIED (Q-D9); the recurring list as T-PARTIAL
//   (M-13), with its sentence when the API found nothing; a real zero when
//   there is no spending; receipt filters as pressed toggle buttons.
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/spending-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { noSpendingFixture, prototypeSampleWithBackendAnalytics, stressOverviewFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { spendingFigures } = await import("../src/lib/statement/spending.ts");
const { formatKes } = await import("../src/lib/format.ts");
const { SpendingHeader, ChannelsCard, NotCountedCard } = await import("../src/components/spending/spending-summary-cards.tsx");
const { RankedMerchantsCard } = await import("../src/components/spending/ranked-merchants-card.tsx");
const { ReceiptPreviewCard } = await import("../src/components/spending/receipt-preview-card.tsx");
const { RecurringUtilitiesCard } = await import("../src/components/spending/recurring-utilities-card.tsx");

const IMPORT_ID = 1;
const PERIOD = "1 Jul 2024 – 31 Jul 2024";
const F5 = prototypeSampleWithBackendAnalytics();
const STRESS = stressOverviewFixture();
const NONE = noSpendingFixture();

/** Spending figures of `fixture` with its rows loaded. */
function figuresOf(fixture) {
  return spendingFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) });
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
/** The Ledger link of a Spending door, encoded as URLSearchParams encodes it (a space is "+"). */
const door = (scopeId) => `/ledger?${new URLSearchParams({ scope: scopeId, from: "spending", import: String(IMPORT_ID) })}`;

describe("header (Q-D1)", () => {
  test("the principal headline is a door to the Spending scope; count, daily average and share of money out answer the question", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(SpendingHeader, { breakdown, period: PERIOD });
    const shown = text(html);
    assert.match(html, /<h2[^>]*>What did I consume\?<\/h2>/);
    assert.ok(hrefs(html).includes(door("bucket:spending")));
    assert.ok(shown.includes(kes(breakdown.totalCents)));
    assert.ok(shown.includes(`${breakdown.count} payments`), shown);
    assert.ok(shown.includes(`about ${kes(breakdown.dailyAverageCents)} a day`), shown);
    assert.ok(shown.includes(`${breakdown.shareOfOut.toFixed(1)}% of everything that went out`), shown);
    assert.match(shown, /Calculated from your transactions/);
  });

  test("linked charges are a secondary line without a door, counted in Fees, and no API total-cost figure appears", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(SpendingHeader, { breakdown, period: PERIOD });
    assert.ok(breakdown.linkedChargeCents > 0);
    const shown = text(html);
    assert.ok(shown.includes(`Charges linked to these payments: ${kes(breakdown.linkedChargeCents)}`), shown);
    assert.match(shown, /counted in Fees/);
    assert.equal(hrefs(html).filter((href) => href.startsWith("/ledger")).length, 1, "only the headline is a door");
    const expenditure = F5.snapshot.result.spending.monthly_expenditure[0].expenditure;
    assert.ok(!shown.includes(formatKes(expenditure)), "the API's total-cost spending is not shown");
  });

  test("T-UNVERIFIED: R2.2's wording and no derived figure", () => {
    const shown = text(render(SpendingHeader, { breakdown: { status: "unverified" }, period: PERIOD }));
    assert.match(shown, /We can't confirm that this breakdown adds up to the totals calculated when your statement was imported, so it's hidden\./);
    assert.doesNotMatch(shown, /KES|%/);
  });

  test("no spending: a real KES 0.00, said plainly, with no door to an empty scope", () => {
    const { breakdown } = figuresOf(NONE);
    const html = render(SpendingHeader, { breakdown, period: PERIOD });
    assert.ok(text(html).includes(kes(0)));
    assert.match(text(html), /No payments for goods, bills or data/);
    assert.ok(!hrefs(html).some((href) => href.startsWith("/ledger")));
  });
});

describe("what counts and what doesn't", () => {
  test("channels with their payments, amounts, DR-7 shares and channel scopes", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(ChannelsCard, { breakdown });
    const shown = text(html);
    for (const channel of breakdown.channels) {
      assert.ok(shown.includes(kes(channel.cents)), channel.channel);
      assert.ok(shown.includes(`${channel.count} payments`), channel.channel);
      assert.ok(shown.includes(`${channel.share.toFixed(1)}%`), channel.channel);
      assert.ok(hrefs(html).includes(door(channel.scopeId)), channel.scopeId);
    }
    assert.doesNotMatch(shown, /Airtime/);
  });

  test("not counted: every other outflow bucket with its scope; airtime says it isn't counted in Spending (Q-D2)", () => {
    const { breakdown } = figuresOf(F5);
    const html = render(NotCountedCard, { notCounted: breakdown.notCounted });
    const shown = text(html);
    assert.ok(shown.includes(kes(breakdown.notCounted.totalCents)));
    for (const item of breakdown.notCounted.items) {
      assert.ok(shown.includes(kes(item.cents)), item.bucket);
      assert.ok(hrefs(html).includes(door(item.scopeId)), item.scopeId);
    }
    assert.match(shown, /Airtime [^K]*not counted in Spending/);
  });

  test("no spending: the channels card says so; the not-counted card still accounts for money out", () => {
    const { breakdown } = figuresOf(NONE);
    assert.match(text(render(ChannelsCard, { breakdown })), /No spending in this statement/);
    assert.ok(text(render(NotCountedCard, { notCounted: breakdown.notCounted })).includes(kes(breakdown.moneyOutCents)));
  });
});

describe("merchants, receipts and recurring payments", () => {
  test("merchants ranked by principal, each a door to its group scope; long names truncate by style only", () => {
    for (const fixture of [F5, STRESS]) {
      const { breakdown } = figuresOf(fixture);
      const html = render(RankedMerchantsCard, { merchants: breakdown.merchants });
      const shown = text(html);
      for (const merchant of breakdown.merchants.items) {
        assert.ok(shown.includes(merchant.label) && shown.includes(kes(merchant.cents)), merchant.label);
        assert.ok(hrefs(html).includes(door(merchant.scopeId)), merchant.scopeId);
      }
      assert.match(html, /truncate/);
    }
  });

  test("receipt preview: filters are pressed-state buttons, the newest receipts open their receipt, and the CTA opens all spending rows", () => {
    const { receipts, breakdown } = figuresOf(F5);
    const html = render(ReceiptPreviewCard, { receipts });
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-pressed=/g) ?? []).length, receipts.filters.length);
    for (const receipt of receipts.previews.all) assert.ok(hrefs(html).includes(door(receipt.scopeId)), receipt.receiptNo);
    assert.ok(hrefs(html).includes(door("bucket:spending")));
    assert.ok(text(html).includes(`See all ${breakdown.count} spending rows in Ledger`));
  });

  test("recurring payments as the API lists them, with T-PARTIAL's sentence; none found says what's needed", () => {
    const { recurring } = figuresOf(F5);
    const html = render(RecurringUtilitiesCard, { recurring });
    const shown = text(html);
    for (const item of recurring) {
      assert.ok(shown.includes(item.name) && shown.includes(`${item.occurrences} payments`), item.name);
      assert.ok(hrefs(html).includes(door(item.scopeId)), item.scopeId);
    }
    assert.match(shown, /at least three payments/);
    assert.doesNotMatch(shown, /KES/, "the API's recurring amounts are total-cost based and not shown (Q-D1)");
    const none = text(render(RecurringUtilitiesCard, { recurring: figuresOf(STRESS).recurring }));
    assert.match(none, /None found yet/);
    assert.match(none, /at least three payments/);
  });
});
