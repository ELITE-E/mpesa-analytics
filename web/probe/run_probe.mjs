#!/usr/bin/env node
// Drives the probe in headless Chrome over CDP, with fresh profiles under .cache/.
//   node web/probe/run_probe.mjs [--repeats 3]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = join(repo, ".cache/chrome-probe");
const chromeBin = process.env.CHROME_BIN ?? "google-chrome-stable";
const repeatsAt = process.argv.indexOf("--repeats");
const repeats = repeatsAt > 0 ? Number(process.argv[repeatsAt + 1]) : 3;
const TIMEOUT_MS = 900_000;
const POLL_INTERVAL_MS = 500;
const THROTTLED = 6;
const UNTHROTTLED = 1;

await main();

/**
 * Run every scenario and print one row per page load.
 *
 * Side effects: starts servers and Chrome, and writes to stdout.
 *
 * @returns {Promise<void>} Resolves when all scenarios have finished.
 */
async function main() {
  console.log(
    "label | csp | cpu | kind | status | total_ms | loadPyodide_ms | loadPandas_ms | groupby_ms | transfer_b | decoded_b | peak_js_heap_b | wasm_heap_b | csp_violations",
  );
  for (let i = 1; i <= repeats; i++) await scenario(`baseline-${i}`, "none", THROTTLED, 2);
  await scenario("unthrottled", "none", UNTHROTTLED, 1);
  await scenario("csp-strict", "strict", THROTTLED, 1);
  await scenario("csp-no-wasm-control", "no-wasm", UNTHROTTLED, 0);
  await printEnvironment();
  process.exit(0);
}

/**
 * Print the browser and core count the numbers were measured with.
 *
 * Side effects: starts a server and Chrome, and writes to stdout.
 *
 * @returns {Promise<void>} Resolves when the line is printed.
 */
async function printEnvironment() {
  const server = await startServer("none");
  const chrome = await startChrome();
  const environment = await load(chrome, server.url, UNTHROTTLED);
  console.log(`environment: cores=${environment.cores} ua=${environment.userAgent}`);
  await chrome.close();
  server.stop();
}

/**
 * Load the probe once cold in a fresh profile, then reload it.
 *
 * Side effects: starts and stops a server and Chrome, and writes to stdout.
 *
 * @param {string} label Name for the output rows.
 * @param {string} csp CSP variant understood by serve.py.
 * @param {number} rate CPU throttling rate.
 * @param {number} reloads Warm reloads after the cold load.
 * @returns {Promise<void>} Resolves when the scenario has finished.
 */
async function scenario(label, csp, rate, reloads) {
  const server = await startServer(csp);
  const chrome = await startChrome();
  try {
    for (let i = 0; i <= reloads; i++) {
      printRow([label, csp, rate], await load(chrome, server.url, rate));
    }
  } finally {
    await chrome.close();
    server.stop();
  }
}

/**
 * Navigate to the probe and wait for it to publish its outcome.
 *
 * Side effects: drives the browser page.
 *
 * @param {{send: Function}} chrome Browser session.
 * @param {string} url Probe URL.
 * @param {number} rate CPU throttling rate.
 * @returns {Promise<object>} The probe's outcome.
 * @throws {Error} If the probe does not finish before the timeout.
 */
async function load(chrome, url, rate) {
  await chrome.send("Page.enable");
  await chrome.send("Emulation.setCPUThrottlingRate", { rate });
  await chrome.send("Page.navigate", { url: "about:blank" });
  await chrome.send("Page.navigate", { url });
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const evaluated = await chrome.send("Runtime.evaluate", {
      expression: "JSON.stringify(window.__probeResult ?? null)",
      returnByValue: true,
    });
    const outcome = JSON.parse(evaluated.result.value ?? "null");
    if (outcome) return outcome;
  }
  throw new Error("probe timed out");
}

/**
 * Print one load as a table row.
 *
 * Side effects: writes to stdout.
 *
 * @param {Array<string|number>} scenarioFields Label, CSP variant and CPU rate.
 * @param {object} outcome The probe's outcome.
 */
function printRow(scenarioFields, outcome) {
  const [label, csp, rate] = scenarioFields;
  console.log(
    [
      label,
      csp,
      `${rate}x`,
      outcome.kind,
      outcome.status,
      rounded(outcome.totalMs),
      rounded(outcome.loadPyodideMs),
      rounded(outcome.loadPandasMs),
      rounded(outcome.groupbyMs),
      outcome.transferBytes,
      outcome.decodedBytes,
      rounded(outcome.peakJsHeapBytes),
      rounded(outcome.wasmHeapBytes),
      outcome.violations,
    ].join(" | "),
  );
  if (outcome.status !== "ok") {
    console.log(`  error: ${outcome.error}; first violations: ${outcome.violationDetail}`);
  }
}

/**
 * Round a measurement for display.
 *
 * Side effects: none.
 *
 * @param {number|null|undefined} value Measurement.
 * @returns {number|string} The rounded number, or a dash when missing.
 */
function rounded(value) {
  return value == null ? "-" : Math.round(value);
}

/**
 * Start the probe's static server on a free port.
 *
 * Side effects: spawns a Python process.
 *
 * @param {string} csp CSP variant understood by serve.py.
 * @returns {Promise<{url: string, stop: Function}>} The probe URL and a stop function.
 */
function startServer(csp) {
  const python = process.env.PYTHON ?? "python3";
  const child = spawn(python, [join(repo, "web/probe/serve.py"), "--port", "0", "--csp", csp]);
  return lineFrom(child.stdout, /http:\S+/).then((url) => ({ url, stop: () => child.kill() }));
}

/**
 * Start headless Chrome with a fresh profile and attach to a blank tab.
 *
 * Side effects: spawns Chrome and creates a profile under `.cache/`.
 *
 * @returns {Promise<{send: Function, close: Function}>} A CDP sender and a shutdown function.
 */
async function startChrome() {
  mkdirSync(scratch, { recursive: true });
  const profile = mkdtempSync(join(scratch, "profile-"));
  const child = spawn(
    chromeBin,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--enable-precise-memory-info",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { env: { ...process.env, HOME: profile }, stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await lineFrom(child.stderr, /ws:\/\/\S+/);
  const socket = await openSocket(wsUrl);
  const send = createSender(socket);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  /**
   * Shut Chrome down and delete its profile.
   *
   * Side effects: closes the socket, kills Chrome and removes the profile directory.
   *
   * @returns {Promise<void>} Resolves when Chrome has exited.
   */
  const close = async () => {
    socket.close();
    child.kill();
    await new Promise((resolve) => child.on("close", resolve));
    rmSync(profile, { recursive: true, force: true });
  };
  return { send: (method, params) => send(method, params, sessionId), close };
}

/**
 * Open a WebSocket and wait until it is connected.
 *
 * Side effects: opens a connection.
 *
 * @param {string} wsUrl DevTools WebSocket URL.
 * @returns {Promise<WebSocket>} The connected socket.
 */
async function openSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return socket;
}

/**
 * Build a function that sends CDP commands and pairs each response with its request.
 *
 * Side effects: sets the socket's message handler.
 *
 * @param {WebSocket} socket Connected DevTools socket.
 * @returns {Function} `send(method, params, sessionId)`, returning the command's response.
 */
function createSender(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };
  return (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
}

/**
 * Wait for a process stream to print text matching a pattern.
 *
 * Side effects: adds listeners to the stream.
 *
 * @param {NodeJS.ReadableStream} stream Process stream.
 * @param {RegExp} pattern Pattern to wait for.
 * @returns {Promise<string>} The matched text.
 */
function lineFrom(stream, pattern) {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.on("data", (chunk) => {
      text += chunk;
      const match = text.match(pattern);
      if (match) resolve(match[0]);
    });
    stream.on("close", () => reject(new Error("process closed before ready")));
  });
}
