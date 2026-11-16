// A tiny loopback static server for the CP8a harness, sending the architecture's CSP on every
// response. Test and owner tooling only; CP8b replaces the harness. It never logs a request.
//   node web/harness/serve.js [--port 8000]
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { parseArgs } from "node:util";

const REPO = join(import.meta.dirname, "../..");

/** The CSP from the migration plan's architecture, section 6. Never weakened here (ADR 0013). */
export const ARCHITECTURE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// URL prefix to directory. Nothing else is served.
const ROOTS = {
  "/harness/": join(REPO, "web/harness"),
  "/pdf_reader/": join(REPO, "pdf_reader"),
  "/runtime/": join(REPO, "web/public/runtime"),
};
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".whl": "application/zip",
  ".zip": "application/zip",
};
const NOT_FOUND = 404;
const NOT_ALLOWED = 405;
const OK = 200;
// Runtime files sit under a version named by their manifest's digest, so they never change.
const RUNTIME_CACHE = "public, max-age=31536000, immutable";

/**
 * Start the server on a free loopback port.
 *
 * Side effects: binds a port and serves files from the three roots.
 *
 * @param {object} [options] Server options.
 * @param {string} [options.csp] The CSP header; the architecture's by default.
 * @param {number} [options.port] Port to bind; 0 picks a free one.
 * @param {string} [options.corrupt_runtime_file] Test only: a runtime path, relative to the
 *   version directory, whose bytes are served with one byte changed.
 * @returns {Promise<{origin: string, close: Function}>} The origin and a close function.
 */
export function start_harness_server({
  csp = ARCHITECTURE_CSP,
  port = 0,
  corrupt_runtime_file,
} = {}) {
  const server = createServer((request, response) => {
    serve(request, response, { csp, corrupt_runtime_file }).catch(() => {
      if (!response.headersSent) response.writeHead(NOT_FOUND);
      response.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((closed) => server.close(closed)),
      });
      server.closeIdleConnections?.();
    });
  });
}

/**
 * Answer one request: a GET for a file under a known root, or 404.
 *
 * Side effects: reads the file and writes the response.
 *
 * @param {object} request The HTTP request.
 * @param {object} response The HTTP response.
 * @param {object} options The CSP and the test-only corruption.
 * @returns {Promise<void>} Resolves when the response is written.
 * @throws {Error} If the file cannot be read; the caller answers 404.
 */
async function serve(request, response, options) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(NOT_ALLOWED, { "Content-Security-Policy": options.csp });
    response.end();
    return;
  }
  const located = locate(new URL(request.url, "http://localhost").pathname);
  if (located === null) {
    response.writeHead(NOT_FOUND, { "Content-Security-Policy": options.csp });
    response.end();
    return;
  }
  let body = await readFile(located.path);
  if (located.prefix === "/runtime/" && is_corrupted(located.rest, options.corrupt_runtime_file)) {
    body = Buffer.from(body);
    body[body.length - 1] ^= 1;
  }
  response.writeHead(OK, {
    "Content-Type": TYPES[extname(located.path)] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Content-Security-Policy": options.csp,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": located.prefix === "/runtime/" ? RUNTIME_CACHE : "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

/**
 * Map a URL path to a file under one of the roots, refusing anything that escapes it.
 *
 * Side effects: none.
 *
 * @param {string} pathname The URL path.
 * @returns {{prefix: string, rest: string, path: string}|null} The file, or null.
 */
function locate(pathname) {
  const prefix = Object.keys(ROOTS).find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return null;
  let rest = decodeURIComponent(pathname.slice(prefix.length));
  if (rest === "" || rest.endsWith("/")) rest += "index.html";
  const path = normalize(join(ROOTS[prefix], rest));
  if (!path.startsWith(ROOTS[prefix] + sep)) return null;
  return { prefix, rest, path };
}

/**
 * Tell whether a runtime path is the one a test asked to corrupt.
 *
 * Side effects: none.
 *
 * @param {string} rest The path under /runtime/, starting with the version.
 * @param {string|undefined} corruptRuntimeFile The path to corrupt, relative to the version.
 * @returns {boolean} True if this response must be corrupted.
 */
function is_corrupted(rest, corruptRuntimeFile) {
  return Boolean(corruptRuntimeFile) && rest.split("/").slice(1).join("/") === corruptRuntimeFile;
}

/**
 * Run the server from the command line until interrupted.
 *
 * Side effects: binds a port and prints the harness URL.
 *
 * @returns {Promise<void>} Resolves once the server is listening.
 */
async function main() {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8000" } } });
  const { origin } = await start_harness_server({ port: Number(values.port) });
  process.stdout.write(`${origin}/harness/\n`);
}

if (import.meta.main) await main();
