// Page-level statement data (IA migration Stage 4b): the loads behind StatementDataProvider, which a
// story page makes once and shares between its shell and body.
//   loadImportWithAnalytics: the requested import (or, without one, the latest), then its
//     analytics; null when this session holds none.
//   loadIntactTransactions: every row of that import, rejected like H2 unless H-4 and H-5 hold.
// CP8b: tested at the data layer's seam (src/data/repo.ts) instead of a faked HTTP API, with a
// stand-in engine answering from the contract scenarios (support/scenario-engine.mjs). Each test
// keeps the behaviour of the old test it replaces (docs/decisions/test-edits.md).
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/statement-data.test.mjs

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { scenarioEngine, scenarioPipelineResult } from "./support/scenario-engine.mjs";

globalThis.window = { location: new URL("https://app.test/overview") };

const repo = await import("../src/data/repo.ts");
const { loadImportWithAnalytics, loadIntactTransactions } = await import("../src/components/statement-data.tsx");

const F1 = scenarioPipelineResult("F1-worked-example");
const F2 = scenarioPipelineResult("F2-tied-timestamps");
let engine;

beforeEach(() => {
  engine = scenarioEngine([F1, F2]);
  repo.useEngineForTests(engine);
});

/**
 * Read a statement into the session, as an upload does.
 *
 * @returns {Promise<object>} The created import.
 */
function upload() {
  return repo.uploadStatement(new File([new Uint8Array([0x25])], "statement.pdf"), "");
}

describe("loadImportWithAnalytics", () => {
  test("loads the requested import with its analytics, and asks the engine nothing more (was: the requested import, then its analytics, and nothing else)", async () => {
    const created = await upload();
    const loaded = await loadImportWithAnalytics(created.import.id);
    assert.deepEqual(loaded, { summary: created.import, analytics: F1.report });
    assert.equal(engine.calls.runs, 1);
  });

  test("without an import, loads the latest import and its analytics", async () => {
    await upload();
    const latest = await upload();
    const loaded = await loadImportWithAnalytics(null);
    assert.deepEqual(loaded, { summary: latest.import, analytics: F2.report });
  });

  test("is null, asking the engine nothing, when this session holds no statement", async () => {
    assert.equal(await loadImportWithAnalytics(null), null);
    assert.equal(engine.calls.runs, 0);
  });

  test("rejects with the data layer's error for an import this session does not hold (was: not the user's)", async () => {
    await upload();
    await assert.rejects(loadImportWithAnalytics(99), (error) => error.code === "import_not_found");
  });
});

describe("loadIntactTransactions", () => {
  test("loads every row of the import once", async () => {
    const created = await upload();
    const rows = await loadIntactTransactions(created.import);
    assert.equal(rows.length, F1.transactions.length);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    assert.deepEqual(rows, await repo.getAllTransactions(created.import.id));
  });

  test("rejects like H2 when the rows don't match the summary (H-4)", async () => {
    const created = await upload();
    const summary = { ...created.import, transaction_count: created.import.transaction_count + 1 };
    await assert.rejects(
      loadIntactTransactions(summary),
      (error) => error.status === 0 && error.code === "incomplete_transactions",
    );
  });

  test("rejects like H2 when a row moves money both ways (H-5)", async () => {
    const both = structuredClone(F1);
    both.transactions[0].paid_in = 1;
    both.transactions[0].paid_out = 1;
    repo.useEngineForTests(scenarioEngine([both]));
    const created = await upload();
    await assert.rejects(loadIntactTransactions(created.import), (error) => error.code === "incomplete_transactions");
  });
});
