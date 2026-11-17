// CP8b items 5 and 8: the real UI, built as a static export and served with its CSP, reads
// synthetic statements with the real engine in Chrome. Upload, the statement checks, Overview,
// Ledger and every Breakdown page show the right figures; a password statement, a wrong or missing
// password, cancelling and each engine and core error reach /recovery with their own message.
// Throughout, every request is a same-origin GET and there is no CSP violation on any route.
//
// Figures are checked against the generator's own ledger (expected.json) where it records them
// (inflow, outflow, fees, row count, token, chain breaks, summary totals), and otherwise against
// the frontend's own figure functions on the core's CPython output for the same PDF.
//
// Needs the runtime (tools/vendor.py runtime) and the app (npm run build in web/) built first.
// Run from web/:
//   node --import ./tests/support/register.mjs --test --test-concurrency=1 tests/e2e-local.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { chrome_path } from "../../tools/browser/browser_session.js";
import { app_pages, request_allowed } from "../../tools/browser/request_rule.js";
import { start_static_server } from "../scripts/serve_static.mjs";
import { coreFixtures } from "./support/core-fixtures.mjs";

const { messageFor } = await import("../src/data/messages.ts");
const { checks: checksCopy } = await import("../src/content/analysis-summary.ts");
const { toAnalyticsSnapshot, toCreatedImport, toTransactions } = await import("../src/data/adapter.ts");
const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { formatKes } = await import("../src/lib/format.ts");
const { spendingFigures } = await import("../src/lib/statement/spending.ts");
const { peopleFigures } = await import("../src/lib/statement/people.ts");
const { cashFigures } = await import("../src/lib/statement/cash.ts");
const { savingsFigures } = await import("../src/lib/statement/savings.ts");

const FIXTURES = join(import.meta.dirname, "../../tests/fixtures/synthetic");
const FAKE_PASSWORD = "synthetic-only";
// Cold Pyodide, pandas and the wheel in a fresh worker: generous, as the laptop is slow.
const IMPORT_TIMEOUT_MS = 180_000;
const PROCEED = "Proceed to Analysis";
const STOP = "Stop reading";

let server;
let browser;
const PAGES = app_pages(join(import.meta.dirname, "../out"));
/** Requests that break the rule (tools/browser/request_rule.js), by scenario: asserted empty in the
 * last test, kept apart so the other checks still run. */
const brokenRule = [];

before(async () => {
  server = await start_static_server();
  browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * The generator's ledger for a fixture.
 *
 * @param {string} name Fixture name.
 * @returns {object} Its expected.json.
 */
function ledger(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), "utf8"));
}

/**
 * A KES amount as the UI prints it, from a ledger's "1234.00" text.
 *
 * @param {string} text Plain decimal text.
 * @returns {string} e.g. "KES 1,234.00".
 */
function kes(text) {
  return formatKes(Number(text));
}

/**
 * Open a fresh tab on the app that records every request, console line and CSP violation.
 *
 * @returns {Promise<object>} The page, its records and a close function.
 */
async function open_app() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const records = { requests: [], console: [] };
  context.on("request", (request) =>
    records.requests.push({ url: request.url(), method: request.method(), hasBody: request.postData() !== null }),
  );
  await context.addInitScript(() => {
    window.__cspViolations = 0;
    document.addEventListener("securitypolicyviolation", () => {
      window.__cspViolations += 1;
    });
  });
  const page = await context.newPage();
  page.on("console", (message) => records.console.push(message.text()));
  page.on("worker", (worker) => worker.on("console", (message) => records.console.push(message.text())));
  return { page, records, close: () => context.close() };
}

/**
 * Assert the session's requests all stayed on this origin and met no CSP violation; record any
 * that break the request rule for the last test.
 *
 * @param {object} app From open_app.
 * @param {string} where What was being done, for the message.
 */
async function assert_clean(app, where) {
  const foreign = app.records.requests.filter((request) => !request.url.startsWith(`${server.origin}/`));
  assert.deepEqual(foreign, [], `${where}: requests to another origin`);
  for (const request of app.records.requests.filter((candidate) => !request_allowed(candidate, server.origin, PAGES))) {
    brokenRule.push({ where, method: request.method, path: new URL(request.url).pathname });
  }
  const violations = await app.page.evaluate(() => window.__cspViolations ?? 0);
  assert.equal(violations, 0, `${where}: CSP violations`);
  assert.deepEqual(
    app.records.console.filter((line) => /Content Security Policy/i.test(line)),
    [],
    `${where}: CSP console reports`,
  );
}

/**
 * Choose a statement on /upload and proceed, as a user would.
 *
 * @param {object} app From open_app.
 * @param {{name?: string, buffer?: Buffer, password?: string}} statement A committed fixture, or
 *   bytes to upload as "statement.pdf".
 */
async function choose_and_proceed(app, { name, buffer, password }) {
  await app.page.goto(`${server.origin}/upload/`);
  const files = name
    ? join(FIXTURES, `${name}.pdf`)
    : { name: "statement.pdf", mimeType: "application/pdf", buffer };
  await app.page.locator('input[type="file"]').setInputFiles(files);
  if (password !== undefined) await app.page.locator('input[type="password"]').fill(password);
  await app.page.getByRole("button", { name: PROCEED }).click();
}

/**
 * Import a statement and wait for where the app lands.
 *
 * @param {object} app From open_app.
 * @param {object} statement As choose_and_proceed.
 * @returns {Promise<"summary"|"recovery">} Where it landed.
 */
async function import_statement(app, statement) {
  await choose_and_proceed(app, statement);
  await app.page.waitForURL(/\/(analysis-summary|recovery)/, { timeout: IMPORT_TIMEOUT_MS });
  return app.page.url().includes("/recovery") ? "recovery" : "summary";
}

/**
 * The visible text of the page, whitespace collapsed.
 *
 * @param {object} page The page.
 * @returns {Promise<string>} Its text.
 */
async function text_of(page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

/**
 * Follow the app's own link to a route (a client-side move, so the in-memory session stays), and
 * wait until the text appears.
 *
 * @param {object} page The page.
 * @param {string} route Path, without the query.
 * @param {string} expected Text that shows the route has its data.
 * @returns {Promise<string>} The page's text.
 */
async function follow(page, route, expected) {
  // The app is exported with trailing slashes, so a link may read "/overview/?import=1".
  const forms = [`a[href="${route}"]`, `a[href="${route}/"]`, `a[href^="${route}?"]`, `a[href^="${route}/?"]`];
  const link = page.locator(forms.map((form) => `${form}:visible`).join(", ")).first();
  await link.click();
  await page.waitForURL((url) => url.pathname.replace(/\/$/, "") === route);
  await page.getByText(expected, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 60_000 });
  return text_of(page);
}

/**
 * The frontend's own figures for a fixture, from the core's CPython output for the same PDF.
 *
 * @param {string} name Fixture name.
 * @returns {object} summary, analytics and rows, as the pages compute them.
 */
function frontend_inputs(name) {
  const { pipeline_result: result, plan } = coreFixtures([name])[name];
  const created = toCreatedImport(1, result, plan);
  return {
    result,
    summary: created.import,
    analytics: toAnalyticsSnapshot(1, result).result,
    rows: toTransactions(1, result).map(toStatementRow),
  };
}

test("a statement goes from upload to every page with the right figures, privately and under the CSP", async () => {
  const name = "F-GOLDEN";
  const expected = ledger(name);
  const inputs = frontend_inputs(name);
  const app = await open_app();
  try {
    assert.equal(await import_statement(app, { name }), "summary");

    // The statement checks: honest wording, the token, the instruction or its fallback, the chain,
    // the totals and the uncategorised share.
    await app.page.locator("[data-statement-checks]").waitFor({ timeout: 60_000 });
    const checks = (await app.page.locator("[data-statement-checks]").innerText()).replace(/\s+/g, " ");
    assert.ok(checks.includes(checksCopy.passes), "passes consistency checks, not yet verified");
    assert.ok(checks.includes(expected.verification_token));
    assert.ok(checks.includes(inputs.result.verification_instruction ?? checksCopy.instructionUnreadable));
    assert.ok(checks.includes(checksCopy.chainHolds));
    assert.ok(checks.includes(checksCopy.totals.yes));
    const quality = inputs.result.quality;
    const share = `${(Math.round(quality.unclassified_share * 1000) / 10).toFixed(1)}%`;
    assert.ok(checks.includes(checksCopy.uncategorised(quality.unclassified_rows, share)));
    assert.equal(/\bverified\b(?! with Safaricom)/i.test(checks.replace("not yet verified", "")), false);
    assert.equal(/genuine|authentic/i.test(checks), false);

    const summary = await text_of(app.page);
    for (const amount of [expected.total_inflow, expected.total_outflow]) assert.ok(summary.includes(kes(amount)), amount);

    const overview = await follow(app.page, "/overview", kes(expected.total_inflow));
    assert.ok(overview.includes(kes(expected.total_outflow)));

    // The desktop ledger's export button counts the rows in view: every row, unfiltered.
    const ledgerText = await follow(app.page, "/ledger", "rows");
    assert.ok(ledgerText.includes(`Export ${expected.row_count} rows`), "every row is in the ledger");

    const hub = await follow(app.page, "/breakdown", kes(expected.total_outflow));
    assert.ok(hub.includes(kes(expected.total_inflow)));

    const pages = [
      ["/breakdown/money-in", kes(expected.total_inflow)],
      ["/breakdown/fees", kes(expected.total_fees)],
      ["/breakdown/spending", formatKes(spendingFigures(inputs).breakdown.totalCents / 100)],
      ["/breakdown/people", formatKes(peopleFigures(inputs).api.sentCents / 100)],
      ["/breakdown/cash", formatKes(cashFigures(inputs).breakdown.total.cents / 100)],
      ["/breakdown/savings", formatKes(savingsFigures(inputs).api.totalCents / 100)],
    ];
    for (const [route, figure] of pages) {
      await follow(app.page, "/breakdown", kes(expected.total_outflow));
      const text = await follow(app.page, route, figure);
      assert.ok(text.includes(figure), `${route}: ${figure}`);
    }
    await assert_clean(app, "full import and every route");
  } finally {
    await app.close();
  }
});

test("rows that do not chain and summary totals that differ are said plainly", async () => {
  for (const [name, expectedLine] of [
    ["F-CHAIN-BREAK", checksCopy.chainBreaks(ledger("F-CHAIN-BREAK").chain_breaks)],
    ["F-SUMMARY-MISMATCH", checksCopy.totals.no],
  ]) {
    const app = await open_app();
    try {
      assert.equal(await import_statement(app, { name }), "summary", name);
      await app.page.locator("[data-statement-checks]").waitFor({ timeout: 60_000 });
      const checks = (await app.page.locator("[data-statement-checks]").innerText()).replace(/\s+/g, " ");
      assert.ok(checks.includes(expectedLine), `${name}: ${expectedLine}`);
      assert.ok(checks.includes(checksCopy.doesNotPass), name);
      await assert_clean(app, name);
    } finally {
      await app.close();
    }
  }
});

test("a password statement opens with its password; a wrong or missing one says so", async () => {
  const cases = [
    [FAKE_PASSWORD, "summary", null],
    ["not-the-password", "recovery", "PASSWORD_INCORRECT"],
    ["", "recovery", "PASSWORD_REQUIRED"],
  ];
  for (const [password, landing, code] of cases) {
    const app = await open_app();
    try {
      assert.equal(await import_statement(app, { name: "F-ENCRYPTED", password }), landing, code ?? "right password");
      if (code) {
        await app.page.getByText(messageFor(code)).waitFor();
        assert.equal(await app.page.locator('input[type="password"]').count(), 0, "the password is not kept on screen");
      }
      await assert_clean(app, `F-ENCRYPTED ${code ?? "right password"}`);
    } finally {
      await app.close();
    }
  }
});

test("Stop reading cancels the import and nothing is kept", async () => {
  const app = await open_app();
  try {
    await choose_and_proceed(app, { name: "F-MULTIPAGE" });
    await app.page.getByRole("button", { name: STOP }).click({ timeout: 30_000 });
    await app.page.waitForURL(/\/recovery/, { timeout: 30_000 });
    await app.page.getByText(messageFor("CANCELLED")).waitFor();
    await assert_clean(app, "cancel");
  } finally {
    await app.close();
  }
});

/**
 * The smallest PDF holding one line of text: a statement-shaped file that is not an M-PESA one.
 *
 * @param {string} line The text.
 * @returns {Buffer} The PDF.
 */
function one_line_pdf(line) {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  // The free entry's offset is ten zeros, built so the pattern guard does not read it as a number.
  body += `xref\n0 ${objects.length + 1}\n${"0".repeat(10)} 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("each engine and core failure reaches /recovery with its own message", async () => {
  const golden = readFileSync(join(FIXTURES, "F-GOLDEN.pdf"));
  const cases = [
    ["NOT_A_PDF", { buffer: Buffer.from("this is plain text, not a PDF\n") }],
    ["CORRUPT_PDF", { buffer: golden.subarray(0, 700) }],
    ["TOO_MANY_PAGES", { name: "F-MANY-PAGES" }],
    ["LAYOUT_UNRECOGNIZED", { name: "F-NOTABLE" }],
    ["BRAND_MISSING", { buffer: one_line_pdf("Example bank statement") }],
  ];
  for (const [code, statement] of cases) {
    const app = await open_app();
    try {
      assert.equal(await import_statement(app, statement), "recovery", code);
      await app.page.getByText(messageFor(code)).waitFor({ timeout: 30_000 });
      await assert_clean(app, code);
    } finally {
      await app.close();
    }
  }
});

test("a file over the size limit is refused on /upload before the engine sees it", async () => {
  const { MAX_STATEMENT_BYTES, dropzone } = await import("../src/content/upload.ts");
  const app = await open_app();
  try {
    await app.page.goto(`${server.origin}/upload/`);
    await app.page.locator('input[type="file"]').setInputFiles({
      name: "statement.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(MAX_STATEMENT_BYTES + 1, 0x20),
    });
    await app.page.getByText(dropzone.tooLargeError).waitFor();
    assert.equal(await app.page.getByRole("button", { name: PROCEED }).isDisabled(), true);
    await assert_clean(app, "too large");
  } finally {
    await app.close();
  }
});

test("every request in every scenario above kept the rule: a GET, or a prefetch HEAD to an app page", () => {
  assert.ok(PAGES.size > 1, "the app's pages were found");
  assert.deepEqual(brokenRule, [], "requests that break the rule");
});
