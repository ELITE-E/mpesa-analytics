// CP8b item 4: the upload flow on the local engine. Progress reaches the processing screen stage by
// stage with page counts, cancelling stops the engine and forgets the file and its password, and
// the app warms the engine up once, as soon as it opens.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/upload-flow-local.test.mjs

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { coreFixtures } from "./support/core-fixtures.mjs";

globalThis.window = { location: new URL("https://app.test/") };

const repo = await import("../src/data/repo.ts");
const flow = await import("../src/lib/upload-flow.ts");
const { messageFor } = await import("../src/data/messages.ts");

const { "F-BASIC": basic } = coreFixtures(["F-BASIC"]);
const STATEMENT = () => new File([new Uint8Array([0x25, 0x50])], "statement.pdf");

/**
 * A fake engine that reports the given steps, then answers with F-BASIC, unless cancelled first.
 *
 * @param {object[]} steps Progress steps to report.
 * @returns {object} The engine and what was asked of it.
 */
function fake_engine(steps = []) {
  const calls = { runs: [], warmUps: 0, cancels: 0 };
  let cancel = null;
  const engine = {
    calls,
    async run(request) {
      calls.runs.push(request);
      for (const step of steps) request.on_progress?.(step);
      return new Promise((resolve) => {
        cancel = () => resolve({ ok: false, failure: { code: "CANCELLED", stage: "engine" } });
        if (!request.hold) {
          resolve({
            ok: true,
            pipeline_result_json: JSON.stringify(basic.pipeline_result),
            plan_json: JSON.stringify(basic.plan),
          });
        }
      });
    },
    async warm_up() {
      calls.warmUps += 1;
      return { ok: true, timings: {} };
    },
    cancel() {
      calls.cancels += 1;
      cancel?.();
    },
  };
  return engine;
}

beforeEach(() => flow.resetUploadFlowForTests());

test("each engine step reaches the upload's progress callback", async () => {
  const steps = [
    { stage: "reading", page: 1, page_count: 2 },
    { stage: "reading", page: 2, page_count: 2 },
    { stage: "core" },
  ];
  repo.useEngineForTests(fake_engine(steps));
  const seen = [];
  await repo.uploadStatement(STATEMENT(), "", { onProgress: (step) => seen.push(step) });
  assert.deepEqual(seen, steps);
});

test("the processing screen's flow shares the latest progress with its subscribers", async () => {
  repo.useEngineForTests(fake_engine([{ stage: "reading", page: 3, page_count: 7 }]));
  flow.setPendingUpload(STATEMENT(), "");
  const seen = [];
  const unsubscribe = flow.subscribeUploadProgress(() => seen.push(flow.uploadProgress()));
  await flow.submitPendingUpload();
  unsubscribe();
  assert.deepEqual(seen[0], { stage: "reading", page: 3, page_count: 7 });
});

test("cancelling stops the engine, rejects as CANCELLED and forgets the file and password", async () => {
  const engine = fake_engine();
  repo.useEngineForTests({ ...engine, run: (request) => engine.run({ ...request, hold: true }) });
  flow.setPendingUpload(STATEMENT(), "synthetic-only");
  const submitted = flow.submitPendingUpload();
  flow.cancelPendingUpload();
  await assert.rejects(submitted, { code: "CANCELLED", message: messageFor("CANCELLED") });
  assert.equal(engine.calls.cancels, 1);
  assert.equal(flow.hasPendingUpload(), false);
  assert.equal(flow.pendingFileName(), null);
});

test("the password goes to the engine once and is not kept after the upload", async () => {
  const engine = fake_engine();
  repo.useEngineForTests(engine);
  flow.setPendingUpload(STATEMENT(), "synthetic-only");
  await flow.submitPendingUpload();
  assert.equal(engine.calls.runs.length, 1);
  assert.equal(engine.calls.runs[0].password, "synthetic-only");
  assert.equal(flow.hasPendingUpload(), false);
});

test("warming up starts the engine once, however often it is asked", async () => {
  const engine = fake_engine();
  repo.useEngineForTests(engine);
  await Promise.all([repo.warmUp(), repo.warmUp()]);
  await repo.warmUp();
  assert.equal(engine.calls.warmUps, 1);
});

test("the warm-up component renders nothing, so it never blocks the page", async () => {
  const { EngineWarmUp } = await import("../src/components/engine-warm-up.tsx");
  assert.equal(renderToString(createElement(EngineWarmUp)), "");
});

test("the root layout includes the warm-up", async () => {
  const { readFileSync } = await import("node:fs");
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<EngineWarmUp \/>/);
});

test("concurrent submissions share one engine run and one result (was M2)", async () => {
  const engine = fake_engine();
  repo.useEngineForTests(engine);
  flow.setPendingUpload(STATEMENT(), "");
  const [first, second] = await Promise.all([flow.submitPendingUpload(), flow.submitPendingUpload()]);
  assert.equal(engine.calls.runs.length, 1);
  assert.equal(first, second);
});

test("a retryable failure keeps the file for an unchanged retry; any other forgets it (was M3)", async () => {
  repo.useEngineForTests({ run: async () => ({ ok: false, failure: { code: "TIMEOUT", stage: "engine" } }) });
  flow.setPendingUpload(STATEMENT(), "synthetic-only");
  await assert.rejects(flow.submitPendingUpload(), { code: "TIMEOUT" });
  assert.equal(flow.hasPendingUpload(), true);
  repo.useEngineForTests({ run: async () => ({ ok: false, failure: { code: "PASSWORD_INCORRECT", stage: "reader" } }) });
  await assert.rejects(flow.submitPendingUpload(), { code: "PASSWORD_INCORRECT" });
  assert.equal(flow.hasPendingUpload(), false);
});
