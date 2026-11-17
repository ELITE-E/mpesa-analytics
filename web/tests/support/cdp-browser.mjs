// A real Chrome, driven over the Chrome DevTools Protocol with Node's
// built-in WebSocket: no browser-test dependency and no browser download.
// The page's CSP is never bypassed (Page.setBypassCSP is not used).
//
// Each opened page records, as structured events rather than console text:
//   * `securitypolicyviolation` events (via a binding added before any page
//     script runs; DevTools-injected scripts are not subject to the CSP),
//   * uncaught exceptions (Runtime.exceptionThrown),
//   * console.error / console.assert calls (Runtime.consoleAPICalled),
//   * browser log entries (Log.entryAdded: network, security, …),
//   * every network request with its response headers, redirect hops and
//     failure reason (Network.*; a CSP block shows as blockedReason "csp").
//
// CHROME_PATH selects the browser binary (default: google-chrome-stable).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_CHROME = "/usr/bin/google-chrome-stable";
const COMMAND_TIMEOUT_MS = 30_000;

/** The Chrome binary to launch. */
export function chromePath() {
  return process.env.CHROME_PATH || DEFAULT_CHROME;
}

/** Resolve after `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** One WebSocket connection to the browser, multiplexing page sessions. */
class CdpConnection {
  /** Wrap an open WebSocket. */
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => this.receive(JSON.parse(event.data)));
  }

  /** Route a protocol message to its pending command or to event listeners. */
  receive(message) {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  /** Send a command (to a page session when `sessionId` is given). */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolveSend, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

/** A launched headless Chrome with its own throwaway profile. */
export class Browser {
  /** Use `launchBrowser()` instead. */
  constructor(child, profileDir, connection) {
    this.child = child;
    this.profileDir = profileDir;
    this.connection = connection;
  }

  /** The browser's version string, e.g. "Chrome/152.0.7977.64". */
  async version() {
    return (await this.connection.send("Browser.getVersion")).product;
  }

  /** Open a new tab with event recording on, still at about:blank. */
  async newPage() {
    const { targetId } = await this.connection.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.connection.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this.connection, targetId, sessionId);
    await page.start();
    return page;
  }

  /** Close the browser and delete its profile. */
  async close() {
    const exited = new Promise((resolveExit) => this.child.once("exit", resolveExit));
    try {
      await this.connection.send("Browser.close");
    } catch {
      process.kill(-this.child.pid, "SIGKILL");
    }
    await Promise.race([exited, sleep(10_000)]);
    rmSync(this.profileDir, { recursive: true, force: true });
  }
}

/** Launch headless Chrome and connect to its DevTools endpoint. */
export async function launchBrowser() {
  const binary = chromePath();
  if (!existsSync(binary)) throw new Error(`Chrome not found at ${binary}; set CHROME_PATH`);
  const profileDir = mkdtempSync(join(tmpdir(), "browser-csp-profile-"));
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-component-update",
      "--window-size=1280,900",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  const portFile = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  while (!existsSync(portFile) || readFileSync(portFile, "utf8").split("\n").length < 2) {
    if (child.exitCode !== null) throw new Error("Chrome exited during startup");
    if (Date.now() > deadline) throw new Error("Chrome did not open a DevTools port");
    await sleep(100);
  }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => reject(new Error("DevTools connection failed")), { once: true });
  });
  return new Browser(child, profileDir, new CdpConnection(socket));
}

// Installed before any page script; reports each violation through the
// `__reportCspViolation` binding.
const VIOLATION_LISTENER = `
  document.addEventListener("securitypolicyviolation", (event) => {
    globalThis.__reportCspViolation(JSON.stringify({
      effectiveDirective: event.effectiveDirective,
      violatedDirective: event.violatedDirective,
      blockedURI: event.blockedURI,
      sourceFile: event.sourceFile,
      lineNumber: event.lineNumber,
      sample: event.sample,
      disposition: event.disposition,
      documentURI: event.documentURI,
    }));
  }, true);
`;

/** One tab and everything it recorded. */
export class Page {
  /** Use `Browser.newPage()` instead. */
  constructor(connection, targetId, sessionId) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.violations = [];
    this.exceptions = [];
    this.consoleErrors = [];
    this.logEntries = [];
    this.requests = new Map();
    this.loadWaiters = [];
    connection.listeners.add((message) => {
      if (message.sessionId === sessionId) this.record(message.method, message.params);
    });
  }

  /** Send a command to this tab. */
  send(method, params) {
    return this.connection.send(method, params, this.sessionId);
  }

  /** Enable the domains whose events are recorded and install the CSP listener. */
  async start() {
    await Promise.all([
      this.send("Page.enable"),
      this.send("Runtime.enable"),
      this.send("Network.enable"),
      this.send("Log.enable"),
    ]);
    await this.send("Runtime.addBinding", { name: "__reportCspViolation" });
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: VIOLATION_LISTENER });
  }

  /** File one protocol event into the matching record. */
  record(method, params) {
    switch (method) {
      case "Runtime.bindingCalled":
        if (params.name === "__reportCspViolation") this.violations.push(JSON.parse(params.payload));
        break;
      case "Runtime.exceptionThrown":
        this.exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
        break;
      case "Runtime.consoleAPICalled":
        if (params.type === "error" || params.type === "assert") {
          this.consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
        }
        break;
      case "Log.entryAdded":
        this.logEntries.push(params.entry);
        break;
      case "Network.requestWillBeSent": {
        const existing = this.requests.get(params.requestId);
        if (existing && params.redirectResponse) {
          existing.redirects.push({
            url: existing.url,
            status: params.redirectResponse.status,
            headers: lowerCaseKeys(params.redirectResponse.headers),
          });
          existing.url = params.request.url;
          break;
        }
        this.requests.set(params.requestId, {
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          requestHeaders: lowerCaseKeys(params.request.headers),
          type: params.type,
          initiator: params.initiator?.type,
          loaderId: params.loaderId,
          redirects: [],
          status: null,
          headers: {},
          failure: null,
          finished: false,
        });
        break;
      }
      case "Network.responseReceived": {
        const request = this.requests.get(params.requestId);
        if (!request) break;
        request.status = params.response.status;
        request.headers = lowerCaseKeys(params.response.headers);
        request.type = params.type;
        // Headers of a cached response are the stored copy, not this server reply.
        request.fromCache = Boolean(params.response.fromDiskCache || params.response.fromPrefetchCache);
        break;
      }
      case "Network.loadingFinished": {
        const request = this.requests.get(params.requestId);
        if (request) request.finished = true;
        break;
      }
      case "Network.loadingFailed": {
        const request = this.requests.get(params.requestId);
        if (request) {
          request.failure = {
            errorText: params.errorText,
            blockedReason: params.blockedReason ?? null,
            corsError: params.corsErrorStatus?.corsError ?? null,
            canceled: params.canceled ?? false,
          };
        }
        break;
      }
      case "Page.loadEventFired":
        for (const resolveLoad of this.loadWaiters.splice(0)) resolveLoad();
        break;
    }
  }

  /**
   * Bypass the browser cache, so every response is a fresh server reply
   * (Chrome's cached copy of a response does not keep all its headers).
   */
  async disableCache() {
    await this.send("Network.setCacheDisabled", { cacheDisabled: true });
  }

  /** Navigate the tab to `url` and wait for its load event. */
  async goto(url) {
    const loaded = new Promise((resolveLoad) => this.loadWaiters.push(resolveLoad));
    const result = await this.send("Page.navigate", { url });
    if (result.errorText) throw new Error(`navigation to ${url} failed: ${result.errorText}`);
    // The new document's loader: requests still open from the document it
    // replaced (e.g. Next.js link prefetches) never finish in this one.
    this.documentLoaderId = result.loaderId;
    await loaded;
  }

  /** Evaluate `expression` in the page (awaiting promises) and return its value. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  }

  /**
   * Poll `expression` until it is truthy and return its value; on timeout,
   * throw naming `description` and any CSP violations seen so far (the
   * usual reason an expected page change never happens).
   */
  async waitFor(expression, description, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.evaluate(expression);
      if (value) return value;
      if (Date.now() > deadline) {
        const violations = this.violations.map((v) => `${v.effectiveDirective} blocked ${v.blockedURI}`);
        throw new Error(
          `timed out waiting for ${description}` +
            (violations.length ? `; CSP violations: ${violations.join("; ")}` : ""),
        );
      }
      await sleep(100);
    }
  }

  /**
   * Wait until no request of the current document has been in flight for
   * `quietMs`. Requests a previous document left open (it was navigated away
   * from before they finished, and their end is never reported) are not
   * waited for. On timeout, the error names the requests still in flight.
   */
  async waitForNetworkIdle(quietMs = 500, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    const ofCurrentDocument = (request) => !this.documentLoaderId || request.loaderId === this.documentLoaderId;
    const inFlight = () =>
      [...this.requests.values()].filter(
        (request) => ofCurrentDocument(request) && !request.finished && !request.failure && request.url.startsWith("http"),
      );
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      if (inFlight().length > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) return;
      await sleep(50);
    }
    const pending = inFlight().map((request) => `${request.method ?? ""} ${request.url}`.trim());
    throw new Error(`network did not become idle; still in flight: ${pending.join(", ") || "(none recorded)"}`);
  }

  /**
   * Click the centre of the first *visible* element matching `selector` with
   * real mouse events, waiting until one exists. Responsive screens render
   * some controls twice (mobile header and desktop bar), with the copy for
   * the other breakpoint `display: none`; a hidden match has an empty box and
   * is skipped, so the click always lands on the control a user can see.
   */
  async click(selector) {
    const point = await this.waitFor(
      `(() => {
        const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => {
          const box = candidate.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        if (!element) return null;
        element.scrollIntoView({ block: "center" });
        const box = element.getBoundingClientRect();
        return box.width && box.height ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
      })()`,
      `a visible ${selector}`,
    );
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    }
  }

  /** Focus the element matching `selector` by clicking it, then type `text`. */
  async type(selector, text) {
    await this.click(selector);
    await this.send("Input.insertText", { text });
  }

  /** The body of a finished response, as text. */
  async responseBody(requestId) {
    const { body, base64Encoded } = await this.send("Network.getResponseBody", { requestId });
    return base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  }

  /** Recorded requests, oldest first. */
  requestList() {
    return [...this.requests.values()];
  }

  /** Recorded top-level document requests. */
  documents() {
    return this.requestList().filter((request) => request.type === "Document");
  }

  /** Close the tab. */
  async close() {
    await this.connection.send("Target.closeTarget", { targetId: this.targetId });
  }
}

/** A copy of a header object with lower-cased names. */
function lowerCaseKeys(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}
