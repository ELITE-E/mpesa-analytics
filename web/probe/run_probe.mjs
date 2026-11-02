#!/usr/bin/env node
// Drives the probe in headless Chrome over CDP, with fresh profiles under .cache/.
//   node web/probe/run_probe.mjs [--repeats 3]
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = join(repo, ".cache/chrome-probe");
const chromeBin = process.env.CHROME_BIN ?? "google-chrome-stable";
const repeatsAt = process.argv.indexOf("--repeats");
const repeats = repeatsAt > 0 ? Number(process.argv[repeatsAt + 1]) : 3;
const TIMEOUT_MS = 900_000;

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

function startServer(csp) {
  const python = process.env.PYTHON ?? "python3";
  const child = spawn(python, [join(repo, "web/probe/serve.py"), "--port", "0", "--csp", csp]);
  return lineFrom(child.stdout, /http:\S+/).then((url) => ({ url, stop: () => child.kill() }));
}

async function startChrome() {
  mkdirSync(scratch, { recursive: true });
  const profile = mkdtempSync(join(scratch, "profile-"));
  const child = spawn(chromeBin, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-sync", "--disable-background-networking", "--disable-component-update",
    "--enable-precise-memory-info", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "about:blank",
  ], { env: { ...process.env, HOME: profile }, stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await lineFrom(child.stderr, /ws:\/\/\S+/);
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const close = async () => {
    socket.close();
    child.kill();
    await new Promise((resolve) => child.on("close", resolve));
    rmSync(profile, { recursive: true, force: true });
  };
  return { send: (method, params) => send(method, params, sessionId), close };
}

async function load(chrome, url, rate) {
  await chrome.send("Page.enable");
  await chrome.send("Emulation.setCPUThrottlingRate", { rate });
  await chrome.send("Page.navigate", { url: "about:blank" });
  await chrome.send("Page.navigate", { url });
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { result } = await chrome.send("Runtime.evaluate", {
      expression: "JSON.stringify(window.__probeResult ?? null)",
      returnByValue: true,
    });
    const value = JSON.parse(result.value ?? "null");
    if (value) return value;
  }
  throw new Error("probe timed out");
}

function row(label, csp, rate, r) {
  const n = (value) => (value == null ? "-" : Math.round(value));
  console.log([
    label, csp, `${rate}x`, r.kind, r.status, n(r.totalMs), n(r.loadPyodideMs), n(r.loadPandasMs),
    n(r.groupbyMs), r.transferBytes, r.decodedBytes, n(r.peakJsHeapBytes), n(r.wasmHeapBytes),
    r.violations,
  ].join(" | "));
  if (r.status !== "ok") console.log(`  error: ${r.error}; first violations: ${r.violationDetail}`);
}

async function scenario(label, csp, rate, reloads) {
  const server = await startServer(csp);
  const chrome = await startChrome();
  try {
    for (let i = 0; i <= reloads; i++) row(label, csp, rate, await load(chrome, server.url, rate));
  } finally {
    await chrome.close();
    server.stop();
  }
}

console.log("label | csp | cpu | kind | status | total_ms | loadPyodide_ms | loadPandas_ms | groupby_ms | transfer_b | decoded_b | peak_js_heap_b | wasm_heap_b | csp_violations");
for (let i = 1; i <= repeats; i++) await scenario(`baseline-${i}`, "none", 6, 2);
await scenario("unthrottled", "none", 1, 1);
await scenario("csp-strict", "strict", 6, 1);
await scenario("csp-no-wasm-control", "no-wasm", 1, 0);
const server = await startServer("none");
const chrome = await startChrome();
const info = await load(chrome, server.url, 1);
console.log(`environment: cores=${info.cores} ua=${info.userAgent}`);
await chrome.close();
server.stop();
process.exit(0);
