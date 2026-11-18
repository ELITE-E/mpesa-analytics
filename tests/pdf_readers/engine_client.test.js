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

test("a run hands the session's transactions to the worker for the import plan (CP8b)", async () => {
  const workers = [];
  const engine = create_statement_engine({
    create_worker: () => workers[workers.push(answering_worker()) - 1],
    runtime_url: RUNTIME_URL,
  });
  await engine.run({ pdf_bytes: new Uint8Array(8), existing_transactions_json: "[]" });
  const runMessage = workers[0].posted.find((message) => message.type === "run");
  assert.equal(runMessage.existing_transactions_json, "[]");
  engine.close();
});

test("progress the worker reports reaches the run's progress callback (CP8b)", async () => {
  const engine = create_statement_engine({
    create_worker: () =>
      fake_worker((message, reply) => {
        if (message.type === "start") reply({ type: "ready", timings: {} });
        if (message.type === "run") {
          reply({
            type: "progress",
            request_id: message.request_id,
            stage: "reading",
            page: 1,
            page_count: 2,
          });
          reply({ type: "progress", request_id: message.request_id, stage: "core" });
          reply({
            type: "run_done",
            request_id: message.request_id,
            ok: true,
            pipeline_result_json: "{}",
            timings: {},
          });
        }
      }),
    runtime_url: RUNTIME_URL,
  });
  const seen = [];
  const outcome = await engine.run({
    pdf_bytes: new Uint8Array(8),
    on_progress: (step) => seen.push(step),
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(seen, [{ stage: "reading", page: 1, page_count: 2 }, { stage: "core" }]);
  engine.close();
});

test("cancel ends a run with CANCELLED, terminates the worker and starts a fresh one (CP8b)", async () => {
  const workers = [];
  let stuck = true;
  const engine = create_statement_engine({
    create_worker: () => workers[workers.push(stuck ? stuck_worker() : answering_worker()) - 1],
    runtime_url: RUNTIME_URL,
  });
  await engine.ready();
  stuck = false;
  const running = engine.run({ pdf_bytes: new Uint8Array(8) });
  await new Promise((resolve) => setImmediate(resolve));
  engine.cancel();
  assert.deepEqual(await running, { ok: false, failure: { code: "CANCELLED", stage: "engine" } });
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  assert.equal((await engine.run({ pdf_bytes: new Uint8Array(8) })).ok, true);
  engine.close();
});

test("warm_up asks the started worker to load the analysis runtime ahead of time (CP8b)", async () => {
  const workers = [];
  const engine = create_statement_engine({
    create_worker: () =>
      workers[
        workers.push(
          fake_worker((message, reply) => {
            if (message.type === "start") reply({ type: "ready", timings: {} });
            if (message.type === "warm_up")
              reply({ type: "warmed", timings: { pandas_load_ms: 5 } });
          }),
        ) - 1
      ],
    runtime_url: RUNTIME_URL,
  });
  const warmed = await engine.warm_up();
  assert.deepEqual(warmed, { ok: true, timings: { pandas_load_ms: 5 } });
  assert.deepEqual(
    workers[0].posted.map((message) => message.type),
    ["start", "warm_up"],
  );
  engine.close();
});

/**
 * A worker that becomes ready only when the test releases it, like a cold Pyodide start, and
 * answers runs as answering_worker does.
 *
 * @returns {{worker: object, release: Function}} The fake worker and its release.
 */
function slow_starting_worker() {
  let release = null;
  const worker = fake_worker((message, reply) => {
    if (message.type === "start") release = () => reply({ type: "ready", timings: {} });
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
  return { worker, release: () => release() };
}

test("cancel while the runtime is still starting ends the run with CANCELLED; the PDF never reaches the worker (CP8b)", async () => {
  const slow = slow_starting_worker();
  const engine = create_statement_engine({
    create_worker: () => slow.worker,
    runtime_url: RUNTIME_URL,
  });
  const outcome = engine.run({ pdf_bytes: new Uint8Array([0x25, 0x50]) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.cancel();
  slow.release();
  assert.deepEqual(await outcome, { ok: false, failure: { code: "CANCELLED", stage: "engine" } });
  assert.deepEqual(
    slow.worker.posted.map((message) => message.type),
    ["start"],
  );
  engine.close();
});

test("a cancel with no run in progress does not cancel the next statement (CP8b)", async () => {
  const engine = create_statement_engine({
    create_worker: answering_worker,
    runtime_url: RUNTIME_URL,
  });
  engine.cancel();
  const outcome = await engine.run({ pdf_bytes: new Uint8Array([0x25]) });
  assert.equal(outcome.ok, true);
  engine.close();
});

/**
 * A worker that starts and answers each core call with the envelope `answer` gives.
 *
 * @param {Function} answer Called with the call message; returns the envelope, or null to stay silent.
 * @returns {object} The fake worker.
 */
function calling_worker(answer) {
  return fake_worker((message, reply) => {
    if (message.type === "start") reply({ type: "ready", timings: {} });
    if (message.type === "core_call") {
      const envelope = answer(message);
      if (envelope) reply({ type: "core_done", request_id: message.request_id, envelope });
    }
  });
}

test("call_core posts the function and JSON text and resolves with the core's envelope (CP9b)", async () => {
  const worker = calling_worker(() => ({ ok: true, answer: { valid: true } }));
  const engine = create_statement_engine({ create_worker: () => worker, runtime_url: RUNTIME_URL });
  const envelope = await engine.call_core("validate_import_plan", '{"plan":1}');
  assert.deepEqual(envelope, { ok: true, answer: { valid: true } });
  const posted = worker.posted.find((message) => message.type === "core_call");
  assert.equal(posted.function_name, "validate_import_plan");
  assert.equal(posted.request_text, '{"plan":1}');
});

test("several core calls in flight each get their own answer", async () => {
  const worker = calling_worker((message) => ({ ok: true, answer: message.function_name }));
  const engine = create_statement_engine({ create_worker: () => worker, runtime_url: RUNTIME_URL });
  const answers = await Promise.all([
    engine.call_core("plan_statement_import", "{}"),
    engine.call_core("analyze_merged", "{}"),
  ]);
  assert.deepEqual(
    answers.map((envelope) => envelope.answer),
    ["plan_statement_import", "analyze_merged"],
  );
});

test("a core call while the runtime cannot load is ENGINE_FAILED", async () => {
  const worker = fake_worker((message, reply) => {
    if (message.type === "start")
      reply({ type: "start_failed", failure: { code: "ENGINE_FAILED", stage: "runtime" } });
  });
  const engine = create_statement_engine({ create_worker: () => worker, runtime_url: RUNTIME_URL });
  assert.deepEqual(await engine.call_core("plan_statement_import", "{}"), {
    ok: false,
    error: { code: "ENGINE_FAILED", row_index: null },
  });
});

test("a core call that never answers times out", async () => {
  const worker = calling_worker(() => null);
  const engine = create_statement_engine({
    create_worker: () => worker,
    runtime_url: RUNTIME_URL,
    timeout_ms: 30,
  });
  assert.deepEqual(await engine.call_core("analyze_merged", "{}"), {
    ok: false,
    error: { code: "TIMEOUT", row_index: null },
  });
});
