import assert from "node:assert/strict";
import { test } from "node:test";

import { create_statement_engine } from "../../pdf_reader/engine_client.js";

const RUNTIME_URL = "/runtime/0000000000000000/";

/**
 * A fake module worker that records messages and answers through a scripted handler.
 *
 * @param {Function} answer Called with each message and a reply function.
 * @returns {object} The fake worker.
 */
function fake_worker(answer) {
  const worker = {
    posted: [],
    transfers: [],
    terminated: false,
    onmessage: null,
    postMessage(message, transfer) {
      worker.posted.push(message);
      worker.transfers.push(transfer ?? []);
      // eslint-disable-next-line id-denylist -- a MessageEvent names this field.
      answer(message, (reply) => queueMicrotask(() => worker.onmessage?.({ data: reply })));
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

/**
 * A worker that starts and answers every run with a fixed pipeline result.
 *
 * @returns {object} The fake worker.
 */
function answering_worker() {
  return fake_worker((message, reply) => {
    if (message.type === "start") reply({ type: "ready", timings: { runtime_load_ms: 1 } });
    if (message.type === "run") {
      reply({
        type: "run_done",
        request_id: message.request_id,
        ok: true,
        pipeline_result_json: "{}",
        timings: {},
      });
    }
  });
}

/**
 * A worker that starts and then never answers a run, like one stuck in pdf.js.
 *
 * @returns {object} The fake worker.
 */
function stuck_worker() {
  return fake_worker((message, reply) => {
    if (message.type === "start") reply({ type: "ready", timings: {} });
  });
}

test("the engine starts the worker with the runtime URL", async () => {
  const workers = [];
  const engine = create_statement_engine({
    create_worker: () => workers[workers.push(answering_worker()) - 1],
    runtime_url: RUNTIME_URL,
  });
  await engine.ready();
  assert.deepEqual(workers[0].posted[0], { type: "start", runtime_url: RUNTIME_URL });
  engine.close();
  assert.equal(workers[0].terminated, true);
});

test("a run transfers the PDF bytes to the worker and returns its outcome", async () => {
  const workers = [];
  const engine = create_statement_engine({
    create_worker: () => workers[workers.push(answering_worker()) - 1],
    runtime_url: RUNTIME_URL,
  });
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const outcome = await engine.run({ pdf_bytes: pdfBytes, password: "synthetic-only" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.pipeline_result_json, "{}");
  const runMessage = workers[0].posted.find((message) => message.type === "run");
  assert.deepEqual(workers[0].transfers[1], [runMessage.pdf_bytes.buffer]);
  assert.equal(JSON.stringify(outcome).includes("synthetic-only"), false);
  engine.close();
});

test("a stuck run times out, the worker is terminated and a fresh one starts", async () => {
  const workers = [];
  let stuck = true;
  const engine = create_statement_engine({
    create_worker: () => workers[workers.push(stuck ? stuck_worker() : answering_worker()) - 1],
    runtime_url: RUNTIME_URL,
    timeout_ms: 30,
  });
  await engine.ready();
  stuck = false;
  const started = Date.now();
  const outcome = await engine.run({ pdf_bytes: new Uint8Array(8) });
  assert.deepEqual(outcome, { ok: false, failure: { code: "TIMEOUT", stage: "engine" } });
  assert.ok(Date.now() - started < 1000);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  const next = await engine.run({ pdf_bytes: new Uint8Array(8) });
  assert.equal(next.ok, true);
  engine.close();
});

test("a worker that never becomes ready fails the start with ENGINE_FAILED", async () => {
  const engine = create_statement_engine({
    create_worker: () => fake_worker(() => undefined),
    runtime_url: RUNTIME_URL,
    start_timeout_ms: 30,
  });
  const outcome = await engine.run({ pdf_bytes: new Uint8Array(8) });
  assert.deepEqual(outcome, { ok: false, failure: { code: "ENGINE_FAILED", stage: "runtime" } });
  engine.close();
});

test("a worker whose runtime fails to load reports ENGINE_FAILED", async () => {
  const engine = create_statement_engine({
    create_worker: () =>
      fake_worker((message, reply) => {
        if (message.type === "start") {
          reply({ type: "start_failed", failure: { code: "ENGINE_FAILED", stage: "runtime" } });
        }
      }),
    runtime_url: RUNTIME_URL,
  });
  const outcome = await engine.run({ pdf_bytes: new Uint8Array(8) });
  assert.deepEqual(outcome.failure, { code: "ENGINE_FAILED", stage: "runtime" });
  engine.close();
});

test("a worker that crashes mid-run reports ENGINE_FAILED and is replaced", async () => {
  const workers = [];
  const engine = create_statement_engine({
    create_worker: () => {
      const worker = fake_worker((message, reply) => {
        if (message.type === "start") reply({ type: "ready", timings: {} });
        if (message.type === "run") queueMicrotask(() => worker.onerror?.({}));
      });
      workers.push(worker);
      return worker;
    },
    runtime_url: RUNTIME_URL,
  });
  const outcome = await engine.run({ pdf_bytes: new Uint8Array(8) });
  assert.deepEqual(outcome.failure, { code: "ENGINE_FAILED", stage: "engine" });
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  engine.close();
});

test("one run may set its own timeout, and the outcome counts worker restarts", async () => {
  const workers = [];
  let stuck = true;
  const engine = create_statement_engine({
    create_worker: () => workers[workers.push(stuck ? stuck_worker() : answering_worker()) - 1],
    runtime_url: RUNTIME_URL,
    timeout_ms: 60_000,
  });
  await engine.ready();
  stuck = false;
  const started = Date.now();
  const outcome = await engine.run({ pdf_bytes: new Uint8Array(8), timeout_ms: 20 });
  assert.equal(outcome.failure.code, "TIMEOUT");
  assert.ok(Date.now() - started < 1000);
  const next = await engine.run({ pdf_bytes: new Uint8Array(8) });
  assert.equal(next.timings.worker_restarts, 1);
  engine.close();
});
