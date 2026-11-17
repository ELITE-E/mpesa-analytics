// Serves the static export (out/) on loopback with the headers postbuild wrote (out/_headers),
// exactly as a static host would: each page with its own CSP, everything else with the plain one.
// For tests and for trying the app by hand; it never logs a request.
//   node scripts/serve_static.mjs [--port 8000]
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { parseArgs } from "node:util";

const OUT = join(import.meta.dirname, "..", "out");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".whl": "application/zip",
  ".zip": "application/zip",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};
const NOT_FOUND = 404;
const OK = 200;

/**
 * The CSP for each path in out/_headers, exact paths and "/prefix/*" patterns alike.
 *
 * @returns {Map<string, string>} Path or pattern to policy.
 */
export function read_headers() {
  const headers = new Map();
  let path = null;
  for (const line of readFileSync(join(OUT, "_headers"), "utf8").split("\n")) {
    if (line && !line.startsWith(" ")) path = line.trim();
    const policy = line.match(/^\s+Content-Security-Policy: (.+)$/);
    if (policy && path) headers.set(path, policy[1]);
  }
  return headers;
}

/**
 * Start the server on a free loopback port.
 *
 * @param {object} [options] Server options.
 * @param {number} [options.port] Port; 0 picks a free one.
 * @returns {Promise<{origin: string, close: Function}>} The origin and a close function.
 */
export function start_static_server({ port = 0 } = {}) {
  const headers = read_headers();
  const server = createServer((request, response) => {
    serve(request, response, headers).catch(() => {
      if (!response.headersSent) response.writeHead(NOT_FOUND);
      response.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((closed) => server.close(closed)),
      }),
    );
  });
}

/**
 * Answer one GET with a file from out/, or the 404 page.
 *
 * @param {object} request The HTTP request.
 * @param {object} response The HTTP response.
 * @param {Map<string, string>} headers Path to CSP.
 * @returns {Promise<void>} Resolves when the response is written.
 */
async function serve(request, response, headers) {
  const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = locate(urlPath);
  const found = file !== null;
  const servedPath = found ? urlPath : "/404.html";
  const body = await readFile(found ? file : join(OUT, "404.html"));
  response.writeHead(found ? OK : NOT_FOUND, {
    "Content-Type": TYPES[extname(found ? file : "x.html")] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Content-Security-Policy": policy_for(servedPath, headers),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

/**
 * The file a URL path names inside out/, refusing anything that escapes it.
 *
 * @param {string} urlPath The URL path.
 * @returns {string|null} The file, or null.
 */
function locate(urlPath) {
  const path = normalize(join(OUT, urlPath));
  if (path !== OUT && !path.startsWith(OUT + sep)) return null;
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/**
 * The CSP for a path: its own block, else the pattern it falls under.
 *
 * @param {string} urlPath The path served.
 * @param {Map<string, string>} headers Path to CSP.
 * @returns {string} The policy.
 */
function policy_for(urlPath, headers) {
  if (headers.has(urlPath)) return headers.get(urlPath);
  for (const [pattern, policy] of headers) {
    if (pattern.endsWith("/*") && urlPath.startsWith(pattern.slice(0, -1))) return policy;
  }
  return headers.get("/404.html");
}

/**
 * Run the server from the command line until interrupted.
 *
 * @returns {Promise<void>} Resolves once listening.
 */
async function main() {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8000" } } });
  const { origin } = await start_static_server({ port: Number(values.port) });
  process.stdout.write(`${origin}/\n`);
}

if (import.meta.main) await main();
