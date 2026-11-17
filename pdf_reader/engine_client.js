// The main thread's handle on the statement engine. The worker holds pdf.js and Pyodide; this
// side only starts it, hands it one statement at a time and enforces the timeout. A stuck worker
// cannot be interrupted from inside, so TIMEOUT terminates it and starts a fresh one.

import { DESKTOP_LIMITS } from "./limits.js";

const DEFAULT_START_TIMEOUT_MS = 120_000;
const READER_DEADLINE_FACTOR = 2;

/**
 * Create a statement engine around a module worker.
 *
 * Side effects: none until the engine is first used; then it starts a worker.
 *
 * @param {object} options How to run the engine.
 * @param {Function} options.create_worker Returns a new worker (a `Worker` or a test fake).
 * @param {string} options.runtime_url URL of the verified runtime, ending in its version and `/`.
 * @param {number} [options.timeout_ms] Longest run, in milliseconds, from handing over the PDF.
 * @param {number} [options.start_timeout_ms] Longest wait for the runtime to load.
 * @returns {{ready: Function, run: Function, warm_up: Function, cancel: Function, close: Function}}
 *   The engine.
 */
export function create_statement_engine({
  create_worker,
  runtime_url,
  timeout_ms = DESKTOP_LIMITS.timeoutMs,
  start_timeout_ms = DEFAULT_START_TIMEOUT_MS,
}) {
  const state = {
    worker: null,
    started: null,
    nextRequestId: 1,
    pending: null,
    restarts: 0,
    warmed: null,
  };
  const settings = { create_worker, runtime_url, timeout_ms, start_timeout_ms };
  return {
    ready: () => ensure_started(state, settings),
    run: (request) => run_statement(state, settings, request),
    warm_up: () => warm_up(state, settings),
    cancel: () => fail_pending(state, { code: "CANCELLED", stage: "engine" }),
    close: () => stop_worker(state),
  };
}

/**
 * Start the worker if none is running, and wait until its runtime has loaded.
 *
 * Side effects: may create a worker and post it the start message.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} settings The engine's options.
 * @returns {Promise<object>} `{ok: true, timings}` once ready, or `{ok: false, failure}`.
 */
function ensure_started(state, settings) {
  if (state.started === null) state.started = start_worker(state, settings);
  return state.started;
}

/**
 * Create a worker and wait for it to report its runtime loaded, or for the start timeout.
 *
 * Side effects: creates a worker, posts it the start message, and sets its handlers.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} settings The engine's options.
 * @returns {Promise<object>} `{ok: true, timings}` or `{ok: false, failure}`.
 */
function start_worker(state, settings) {
  const worker = settings.create_worker();
  state.worker = worker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(runtime_failure()), settings.start_timeout_ms);
    worker.onmessage = ({ data: message }) => {
      if (message.type === "ready") resolve({ ok: true, timings: message.timings });
      else if (message.type === "start_failed") resolve({ ok: false, failure: message.failure });
      else settle_pending(state, message);
      if (message.type === "ready" || message.type === "start_failed") clearTimeout(timer);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      resolve(runtime_failure());
      fail_pending(state, { code: "ENGINE_FAILED", stage: "engine" });
    };
    worker.postMessage({ type: "start", runtime_url: settings.runtime_url });
  });
}

/**
 * Hand one statement to the worker and wait for its outcome or the timeout.
 *
 * The password goes to the worker with the PDF and nowhere else; it is never part of the
 * outcome. The PDF's buffer is transferred, so the caller's copy is emptied.
 *
 * Side effects: posts to the worker; on timeout or crash, terminates it and starts a new one; if
 * the runtime failed to load, terminates the worker so the next run starts afresh.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} settings The engine's options.
 * @param {object} request The statement.
 * @param {Uint8Array} request.pdf_bytes The PDF's bytes.
 * @param {string} [request.password] The PDF's password, if it has one.
 * @param {object} [request.limits] Reader limit overrides.
 * @param {string} [request.processed_at] A time carried into the result.
 * @param {number} [request.timeout_ms] This run's timeout, instead of the engine's.
 * @param {Function} [request.on_progress] Called with each step the worker reports: `{stage:
 *   "reading", page, page_count}`, `{stage: "core"}` or `{stage: "analysis"}`.
 * @param {string} [request.existing_transactions_json] The session's transactions, as JSON text;
 *   given, the outcome also holds the import plan as `plan_json`.
 * @param {boolean} [request.include_statement_pages] Also return the statement pages (tests and
 *   the owner's equivalence check only).
 * @returns {Promise<object>} `{ok: true, pipeline_result_json, timings, statement_pages_json?}`,
 *   where the timings also count the workers restarted so far,
 *   or `{ok: false, failure}`.
 */
async function run_statement(state, settings, request) {
  const started = await ensure_started(state, settings);
  if (!started.ok) {
    // The next run tries a fresh worker rather than reporting this failure forever.
    stop_worker(state);
    return started;
  }
  const requestId = state.nextRequestId++;
  const timeoutMs = request.timeout_ms ?? settings.timeout_ms;
  const outcome = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(timed_out()), timeoutMs);
    state.pending = { requestId, resolve, timer, onProgress: request.on_progress };
  });
  state.worker.postMessage(
    {
      type: "run",
      request_id: requestId,
      pdf_bytes: request.pdf_bytes,
      password: request.password,
      // The engine's timeout is the one that fires; the reader's own deadline is a backstop.
      limits: { timeoutMs: timeoutMs * READER_DEADLINE_FACTOR, ...request.limits },
      processed_at: request.processed_at ?? null,
      include_statement_pages: request.include_statement_pages === true,
      existing_transactions_json: request.existing_transactions_json,
    },
    [request.pdf_bytes.buffer],
  );
  const settled = await outcome;
  clearTimeout(state.pending?.timer);
  state.pending = null;
  if (!settled.ok && settled.failure.stage === "engine") restart_worker(state, settings);
  if (settled.ok) settled.timings = { ...settled.timings, worker_restarts: state.restarts };
  return settled;
}

/**
 * Load the analysis runtime (pandas) in the started worker ahead of the first statement, so the
 * user's first run does not wait for it. Cancelled or crashed workers start cold again.
 *
 * Side effects: may start the worker; posts it the warm-up message.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} settings The engine's options.
 * @returns {Promise<object>} `{ok: true, timings}` once warmed, or the start's failure.
 */
async function warm_up(state, settings) {
  const started = await ensure_started(state, settings);
  if (!started.ok) return started;
  return new Promise((resolve) => {
    state.warmed = resolve;
    state.worker.postMessage({ type: "warm_up" });
  });
}

/**
 * Pass a worker's answer to whoever waits for it: a run's progress or outcome, or the warm-up.
 *
 * Side effects: resolves the pending run.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} message The worker's message.
 */
function settle_pending(state, message) {
  if (message.type === "warmed") {
    state.warmed?.({ ok: true, timings: message.timings });
    return;
  }
  if (state.pending?.requestId !== message.request_id) return;
  const { request_id: _, type: __, ...fields } = message;
  if (message.type === "progress") state.pending.onProgress?.(fields);
  if (message.type === "run_done") state.pending.resolve(fields);
}

/**
 * End the waiting run with a failure.
 *
 * Side effects: resolves the pending run, if any.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} failure The failure to report.
 */
function fail_pending(state, failure) {
  state.pending?.resolve({ ok: false, failure });
}

/**
 * Throw the worker away and start loading a fresh one.
 *
 * Side effects: terminates the worker, creates another and posts it the start message.
 *
 * @param {object} state The engine's mutable state.
 * @param {object} settings The engine's options.
 */
function restart_worker(state, settings) {
  stop_worker(state);
  state.restarts += 1;
  state.started = start_worker(state, settings);
}

/**
 * Terminate the worker, which also ends pdf.js's own worker and Pyodide.
 *
 * Side effects: terminates the worker.
 *
 * @param {object} state The engine's mutable state.
 */
function stop_worker(state) {
  state.worker?.terminate();
  state.worker = null;
  state.started = null;
}

/**
 * The outcome of a run that took too long.
 *
 * Side effects: none.
 *
 * @returns {object} A TIMEOUT failure raised by the engine.
 */
function timed_out() {
  return { ok: false, failure: { code: "TIMEOUT", stage: "engine" } };
}

/**
 * The outcome of a runtime that did not load.
 *
 * Side effects: none.
 *
 * @returns {object} An ENGINE_FAILED failure at the runtime stage.
 */
function runtime_failure() {
  return { ok: false, failure: { code: "ENGINE_FAILED", stage: "runtime" } };
}
