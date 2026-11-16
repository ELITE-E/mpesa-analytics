// Measurement only (CP8a-2): hands steps to stage_timing.worker.js for
// tools/measure_stage_timing.mjs, one at a time, so each stage can be measured on its own.

const RUNTIME_POINTER = "/runtime/current.json";

let worker = null;
let nextId = 1;
const waiting = new Map();

window.stage_timing = { open, step, close };

/**
 * Start a fresh measurement worker on the current runtime.
 *
 * Side effects: terminates any previous worker, fetches the runtime pointer, creates a worker.
 *
 * @returns {Promise<object>} The start step's answer.
 */
async function open() {
  close();
  const pointer = await (await fetch(RUNTIME_POINTER)).json();
  worker = new Worker("/harness/stage_timing.worker.js", { type: "module" });
  worker.onmessage = ({ data: answer }) => {
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  };
  return step("start", { runtime_url: `/runtime/${pointer.version}/` });
}

/**
 * Run one step in the worker.
 *
 * Side effects: posts to the worker; a `set_pdf` step transfers the PDF's bytes.
 *
 * @param {string} name The step.
 * @param {object} [fields] The step's fields; `pdf_base64` becomes transferred bytes.
 * @returns {Promise<object>} The worker's answer.
 */
function step(name, fields = {}) {
  const id = nextId++;
  const message = { id, step: name, ...fields };
  const transfer = [];
  if (fields.pdf_base64) {
    message.pdf_bytes = Uint8Array.fromBase64(fields.pdf_base64);
    delete message.pdf_base64;
    transfer.push(message.pdf_bytes.buffer);
  }
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.postMessage(message, transfer);
  });
}

/**
 * End the worker, freeing its memory.
 *
 * Side effects: terminates the worker.
 */
function close() {
  worker?.terminate();
  worker = null;
}
