// A loopback stand-in for a static host, for the tests of tools/release/check_deployed.mjs. It
// serves the static export the way Cloudflare Pages and Netlify do: clean URLs ("/ledger" from
// ledger.html), the 404 page with status 404 for anything else, and each response's headers from
// the host's generated rules, joined across matching rules (web/scripts/host_headers.mjs). A test
// may plant one fault through `tamper`. It never logs a request.
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import { hostRules, resolveHeaders } from "../../web/scripts/host_headers.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".whl": "application/zip",
  ".zip": "application/zip",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};
const OK = 200;
const NOT_FOUND = 404;
const NOT_SERVED = new Set(["/_headers"]);

/**
 * Start the emulator on a free loopback port.
 *
 * Side effects: binds a port and serves files from outDir.
 *
 * @param {object} options Emulator options.
 * @param {string} options.outDir The static export.
 * @param {string} options.host "cloudflare-pages" or "netlify": whose rules to generate.
 * @param {object} [options.tamper] Faults: `headers(path, headers)` may change a response's
 *   header Map; `body(path, bytes)` returns the bytes to send; `missing` lists paths answered with
 *   404; `extra` maps paths to text answered with 200.
 * @returns {Promise<{origin: string, close: Function}>} The origin and a close function.
 */
export function startHostEmulator({ outDir, host, tamper = {} }) {
  const rules = hostRules(outDir, host);
  const server = createServer((request, response) => {
    answer(request, response, { outDir, rules, tamper }).catch(() => {
      if (!response.headersSent) response.writeHead(NOT_FOUND);
      response.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((closed) => {
            server.closeAllConnections?.();
            server.close(closed);
          }),
      }),
    );
  });
}

/**
 * Answer one request.
 *
 * @param {object} request The HTTP request.
 * @param {object} response The HTTP response.
 * @param {object} site The export, its rules and the planted faults.
 * @param {string} site.outDir The static export.
 * @param {object[]} site.rules The host's rules.
 * @param {object} site.tamper The planted faults (see startHostEmulator).
 * @returns {Promise<void>} Resolves when the response is written.
 */
async function answer(request, response, { outDir, rules, tamper }) {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const found = await content(outDir, path, tamper);
  const bytes = tamper.body ? tamper.body(path, found.bytes) : found.bytes;
  const headers = resolveHeaders(rules, path);
  headers.set("content-type", TYPES[extname(found.typePath)] ?? "application/octet-stream");
  headers.set("content-length", String(bytes.length));
  tamper.headers?.(path, headers);
  response.writeHead(found.status, Object.fromEntries(headers));
  response.end(request.method === "HEAD" ? undefined : bytes);
}

/**
 * What a path serves: a planted extra, the file it names, or the 404 page.
 *
 * @param {string} outDir The static export.
 * @param {string} path The URL path.
 * @param {object} tamper The planted faults.
 * @returns {Promise<{status: number, bytes: Buffer, typePath: string}>} Status, bytes, and the
 *   path whose extension gives the content type.
 */
async function content(outDir, path, tamper) {
  const planted = tamper.extra?.[path];
  if (planted !== undefined) return { status: OK, bytes: Buffer.from(planted), typePath: path };
  const file = tamper.missing?.includes(path) ? null : locate(outDir, path);
  if (!file)
    return {
      status: NOT_FOUND,
      bytes: await readFile(join(outDir, "404.html")),
      typePath: "x.html",
    };
  return { status: OK, bytes: await readFile(file), typePath: file };
}

/**
 * The file a path names inside the export: the file itself, else the route's page, else a
 * folder's index.html; never anything outside the export or the headers file.
 *
 * @param {string} outDir The static export.
 * @param {string} path The URL path.
 * @returns {string|null} The file, or null.
 */
function locate(outDir, path) {
  if (NOT_SERVED.has(path)) return null;
  const route = path === "/" ? "/index" : path.replace(/\/$/, "");
  for (const candidate of [route, `${route}.html`, join(route, "index.html")]) {
    const file = normalize(join(outDir, candidate));
    if (!file.startsWith(outDir + sep)) return null;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}
