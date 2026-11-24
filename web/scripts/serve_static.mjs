// Serves the static export (out/) on loopback with the headers postbuild wrote (out/_headers),
// resolved as the static hosts resolve them (scripts/host_headers.mjs), except Cache-Control: it
// sends no-store, so a test never runs a file cached from an older build. For tests and for trying
// the app by hand; it never logs a request.
//   node scripts/serve_static.mjs [--port 8000]
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { parseArgs } from "node:util";

import { parseRules, resolveHeaders } from "./host_headers.mjs";
import { filesUnder, servedPath } from "./sw_allow_list.mjs";

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
 * The CSP each shipped path is served with, as out/_headers resolves it.
 *
 * @returns {Map<string, string>} Served path ("/", "/overview", "/_next/static/…") to policy.
 */
export function read_headers() {
  const rules = read_rules();
  return new Map(
    filesUnder(OUT).map((file) => {
      const path = servedPath(`/${relative(OUT, file).split(sep).join("/")}`);
      return [path, resolveHeaders(rules, path).get("content-security-policy")];
    }),
  );
}

/**
 * The rules in out/_headers.
 *
 * @returns {object[]} Rules, as scripts/host_headers.mjs parses them.
 */
function read_rules() {
  return parseRules(readFileSync(join(OUT, "_headers"), "utf8"));
}

/**
 * Start the server on a free loopback port.
 *
 * @param {object} [options] Server options.
 * @param {number} [options.port] Port; 0 picks a free one.
 * @param {Function} [options.answer] Tests only: answers some paths itself (see serve).
 * @returns {Promise<{origin: string, close: Function}>} The origin and a close function.
 */
export function start_static_server({ port = 0, answer = null } = {}) {
  const rules = read_rules();
  const server = createServer((request, response) => {
    serve(request, response, rules, answer).catch(() => {
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
 * Answer one GET with a file from out/, or the 404 page. A test may answer some paths itself.
 *
 * @param {object} request The HTTP request.
 * @param {object} response The HTTP response.
 * @param {object[]} rules The rules in out/_headers.
 * @param {Function|null} answer Tests only: given the URL and request, gives `{status, type, body}` to serve
 *   with the path's CSP, or null to serve out/ as usual.
 * @returns {Promise<void>} Resolves when the response is written.
 */
async function serve(request, response, rules, answer) {
  const url = new URL(request.url, "http://localhost");
  const urlPath = decodeURIComponent(url.pathname);
  const answered = answer ? await answer(url, request) : null;
  if (answered) {
    response.writeHead(answered.status, {
      ...headers_for(urlPath, rules),
      "Content-Type": answered.type,
    });
    response.end(request.method === "HEAD" ? undefined : answered.body);
    return;
  }
  const file = locate(urlPath);
  const found = file !== null;
  const body = await readFile(found ? file : join(OUT, "404.html"));
  response.writeHead(found ? OK : NOT_FOUND, {
    ...headers_for(found ? route_of(urlPath) : urlPath, rules),
    "Content-Type": TYPES[extname(found ? file : "x.html")] ?? "application/octet-stream",
    "Content-Length": body.length,
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

/**
 * The route a URL path names: no trailing slash, except the home page's.
 *
 * @param {string} urlPath The URL path.
 * @returns {string} The route.
 */
function route_of(urlPath) {
  return urlPath === "/" ? "/" : urlPath.replace(/\/$/, "");
}

/**
 * The file a URL path names inside out/, refusing anything that escapes it: the file itself, else
 * the route's page ("/ledger" from ledger.html), else a folder's index.html, as static hosts do.
 *
 * @param {string} urlPath The URL path.
 * @returns {string|null} The file, or null.
 */
function locate(urlPath) {
  const route = route_of(urlPath);
  for (const candidate of [route, `${route}.html`, join(route, "index.html")]) {
    const path = normalize(join(OUT, candidate));
    if (path !== OUT && !path.startsWith(OUT + sep)) return null;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

/**
 * The headers for a path, as the host would send them, with Cache-Control replaced by no-store.
 *
 * @param {string} urlPath The path served.
 * @param {object[]} rules The rules in out/_headers.
 * @returns {object} Header name to value.
 */
function headers_for(urlPath, rules) {
  return { ...Object.fromEntries(resolveHeaders(rules, urlPath)), "cache-control": "no-store" };
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
