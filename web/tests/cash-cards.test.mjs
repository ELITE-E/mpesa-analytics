// Cash area cards (IA migration Stage 7e): each card renders the figures it
// is given as props (lib/statement/cash.ts), opens the Ledger scope of each
// figure, and says what the statement can't tell instead of guessing:
//   the header's cash-withdrawn figure and answer (withdrawals, agents, the
//   linked charges and their share, without a door: Q-LINK); T-UNVERIFIED
//   shows no figure, only R2.2's wording (Q-D9); each agent as a door to its
//   withdrawals; the largest withdrawals opening their receipts; what
//   withdrawing cost, counted in Fees; where the cash went isn't on the
//   statement; cash deposits linked to Money In (its screen since Stage 7f
//   yet); a real zero.
// The real components are rendered with renderToString.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/cash-cards.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { contractFixtures } from "./support/contract-fixtures.mjs";
import { cashEdgeCasesFixture } from "./support/sample-api.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { cashFigures } = await import("../src/lib/statement/cash.ts");
const { formatKes } = await import("../src/lib/format.ts");
const { CashHeader, WhereCashWentNote, AgentsCard, LargestWithdrawalsCard, WithdrawalCostCard, DepositsNote } = await import("../src/components/cash/cash-cards.tsx");

const IMPORT_ID = 1;
const EDGE = cashEdgeCasesFixture();
const EMPTY = contractFixtures()["F4-paginated-2345"];

/** Cash figures of `fixture` with its rows loaded. */
function breakdownOf(fixture) {
  return cashFigures({ summary: fixture.summary, analytics: fixture.snapshot.result, rows: fixture.rows.map(toStatementRow) }).breakdown;
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
/** The Ledger link of a Cash door, encoded as URLSearchParams encodes it. */
const door = (scopeId) => `/ledger?${new URLSearchParams({ scope: scopeId, from: "cash", import: String(IMPORT_ID) })}`;

describe("header", () => {
  test("the cash figure is a door to every withdrawal; the answer gives withdrawals, agents and the charges' share, the charges without a door", () => {
    const breakdown = breakdownOf(EDGE);
    const html = render(CashHeader, { breakdown });
    const shown = text(html);
    assert.match(html, /<h2[^>]*>What happened with cash withdrawals\?<\/h2>/);
    assert.deepEqual(links(html).filter((link) => link.href.startsWith("/ledger")).map((link) => link.href), [door("bucket:cash-withdrawn")]);
    assert.ok(shown.includes(kes(1300000)));
    assert.ok(shown.includes(`4 withdrawals at 2 agents. Withdrawing carried ${kes(16300)} in charges, 1.3% of the cash you took out.`), shown);
  });

  test("T-UNVERIFIED: no figure, only R2.2's wording", () => {
    const html = render(CashHeader, { breakdown: { status: "unverified" } });
    assert.match(text(html), /We can't confirm that this breakdown adds up/);
    assert.doesNotMatch(text(html), /KES/);
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });

  test("no withdrawals: a real KES 0.00, said plainly, with no door", () => {
    const html = render(CashHeader, { breakdown: breakdownOf(EMPTY) });
    assert.match(text(html), /You didn't withdraw any cash in this statement/);
    assert.ok(text(html).includes(kes(0)));
    assert.ok(!links(html).some((link) => link.href.startsWith("/ledger")));
  });
});

describe("agents, withdrawals and cost", () => {
  test("each agent is a door to its withdrawals, with its share and no charge inside the door (Q-LINK); an unidentified agent is 'Not identified'", () => {
    const breakdown = breakdownOf(EDGE);
    const html = render(AgentsCard, { agents: breakdown.agents });
    for (const agent of breakdown.agents) {
      assert.ok(links(html).some((link) => link.href === door(agent.scopeId)), agent.scopeId);
      assert.ok(text(html).includes(kes(agent.cents)));
    }
    assert.match(text(html), /2 withdrawals/);
    assert.doesNotMatch(text(html), /charge/i);
    assert.match(text(html), /76\.9%/);
    assert.match(text(html), /Not identified/);
  });

  test("no agents: the card says so", () => {
    assert.match(text(render(AgentsCard, { agents: [] })), /No cash was withdrawn/);
  });

  test("largest withdrawals open their receipts with their charge; the exit opens every withdrawal", () => {
    const breakdown = breakdownOf(EDGE);
    const html = render(LargestWithdrawalsCard, { withdrawals: breakdown.withdrawals, withdrawalCount: breakdown.total.count });
    for (const item of breakdown.withdrawals) assert.ok(links(html).some((link) => link.href === door(item.scopeId)), item.receiptNo);
    assert.ok(text(html).includes(`+ ${kes(6700)} charge`) && text(html).includes("No charge"));
    assert.ok(links(html).some((link) => link.href === door("bucket:cash-withdrawn")));
    assert.ok(text(html).includes("See all 4 withdrawals in Ledger"));
  });

  test("what withdrawing cost: display only, counted once in Fees, with a link to the Fees screen", () => {
    const breakdown = breakdownOf(EDGE);
    const html = render(WithdrawalCostCard, { charges: breakdown.charges });
    assert.ok(text(html).includes(`Withdrawing carried ${kes(16300)} in charges across 3 withdrawals`), text(html));
    assert.deepEqual(links(html).map((link) => link.href), [`/breakdown/fees?import=${IMPORT_ID}`]);
    assert.match(text(render(WithdrawalCostCard, { charges: { cents: 0, count: 0, share: null } })), /No charges were linked to your withdrawals/);
  });
});

describe("notes", () => {
  test("where the cash went isn't on the statement", () => {
    assert.match(text(render(WhereCashWentNote, {})), /Where the cash went isn't on the statement/);
  });

  test("cash deposits are part of Money In, linked to its screen on the import (Stage 7f)", () => {
    const html = render(DepositsNote, {});
    assert.match(text(html), /part of Money In/);
    assert.deepEqual(links(html).map((link) => link.href), [`/breakdown/money-in?import=${IMPORT_ID}`]);
  });
});
