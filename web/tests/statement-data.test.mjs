// Page-level statement data (IA migration Stage 4b): the loads behind
// StatementDataProvider, which a story page makes once and shares between its
// shell and body.
//   loadImportWithAnalytics: the requested import (or, without one, the
//     latest), then its analytics; null when the user has no imports.
//   loadIntactTransactions: every row of that import (getAllTransactions,
//     H-1..H-3), rejected like H2 unless H-4 and H-5 hold.
// fetch is faked at the network edge with the contract fixtures; nothing
// leaves the process. Requests are asserted in order.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-data.test.mjs

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const API_BASE_URL = "https://api.app.test";
process.env.NEXT_PUBLIC_API_BASE_URL = API_BASE_URL;
const sessionStore = new Map([["mpesa.session.token", "tok_STATEMENT_DATA_TEST"], ["mpesa.session.username", "data-user"]]);
globalThis.window = {
  sessionStorage: {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
  },
  location: new URL("https://app.test/overview"),
};

const { loadImportWithAnalytics, loadIntactTransactions } = await import("../src/components/statement-data.tsx");

const F1 = contractFixtures()["F1-worked-example"];
const ID = F1.summary.id;

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

/** F1's transactions as the API pages them (one page of up to 1000 rows). */
function f1TransactionPage(rows = F1.rows) {
  return { [`/api/v1/imports/${ID}/transactions?limit=1000&offset=0`]: [200, { items: rows, total: rows.length, limit: 1000, offset: 0 }] };
}

afterEach(() => {
  delete globalThis.fetch;
});

describe("loadImportWithAnalytics", () => {
  test("loads the requested import, then its analytics, and nothing else", async () => {
    fakeApi({ [`/api/v1/imports/${ID}`]: [200, F1.summary], [`/api/v1/imports/${ID}/analytics`]: [200, F1.snapshot] });
    assert.deepEqual(await loadImportWithAnalytics(ID), { summary: F1.summary, analytics: F1.snapshot.result });
    assert.deepEqual(requestedPaths, [`/api/v1/imports/${ID}`, `/api/v1/imports/${ID}/analytics`]);
  });

  test("without an import, loads the latest import and its analytics", async () => {
    fakeApi({ "/api/v1/imports?limit=1": [200, { items: [F1.summary] }], [`/api/v1/imports/${ID}/analytics`]: [200, F1.snapshot] });
    assert.deepEqual(await loadImportWithAnalytics(null), { summary: F1.summary, analytics: F1.snapshot.result });
    assert.deepEqual(requestedPaths, ["/api/v1/imports?limit=1", `/api/v1/imports/${ID}/analytics`]);
  });

  test("is null, with no further request, when the user has no imports", async () => {
    fakeApi({ "/api/v1/imports?limit=1": [200, { items: [] }] });
    assert.equal(await loadImportWithAnalytics(null), null);
    assert.deepEqual(requestedPaths, ["/api/v1/imports?limit=1"]);
  });

  test("rejects with the API's error for an import that is not the user's", async () => {
    fakeApi({});
    await assert.rejects(loadImportWithAnalytics(99), (error) => error.status === 404 && error.code === "not_found");
    assert.deepEqual(requestedPaths, ["/api/v1/imports/99"]);
  });
});

describe("loadIntactTransactions", () => {
  test("loads every row of the import once", async () => {
    fakeApi(f1TransactionPage());
    assert.deepEqual(await loadIntactTransactions(F1.summary), F1.rows);
    assert.deepEqual(requestedPaths, [`/api/v1/imports/${ID}/transactions?limit=1000&offset=0`]);
  });

  test("rejects like H2 when the rows don't match the summary (H-4)", async () => {
    fakeApi(f1TransactionPage(F1.rows.slice(1)));
    await assert.rejects(loadIntactTransactions(F1.summary), (error) => error.status === 0 && error.code === "incomplete_transactions");
  });

  test("rejects like H2 when a row moves money both ways (H-5)", async () => {
    const rows = structuredClone(F1.rows);
    rows[0].paid_out = 1;
    fakeApi(f1TransactionPage(rows));
    await assert.rejects(loadIntactTransactions(F1.summary), (error) => error.code === "incomplete_transactions");
  });
});
