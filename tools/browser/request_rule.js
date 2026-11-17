// The app's request rule (CP8b, owner decision 2026-11-17), shared by the real-UI test and the
// owner's ui_run: during an import the browser only GETs from the app's own origin, plus the HEAD
// Next's link prefetch sends to one of the app's own pages first. A HEAD carries no data and the
// GET after it names the same page, so it tells the host nothing new. Nothing may carry a body.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const PAGE_SUFFIX = ".html";
const HOME_PAGE = "index.html";
const NOT_FOUND_PAGE = "404.html";
// Folders of the static export that hold assets, never pages.
const ASSET_FOLDERS = new Set(["_next", "runtime", "pdf_reader"]);

/**
 * The app's pages: every HTML page of the static export, as its route ("/", "/upload",
 * "/breakdown/fees"), leaving out the 404 page.
 *
 * Side effects: reads the export's folders.
 *
 * @param {string} outDir The static export (web/out).
 * @returns {Set<string>} The routes.
 */
export function app_pages(outDir) {
  const pages = new Set();
  /**
   * Add a folder's pages, then its subfolders' pages.
   *
   * @param {string} directory The folder on disk.
   * @param {string} prefix Its route, ending in "/".
   */
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ASSET_FOLDERS.has(entry.name))
          walk(join(directory, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name === HOME_PAGE && prefix === "/") {
        pages.add("/");
      } else if (entry.name.endsWith(PAGE_SUFFIX) && entry.name !== NOT_FOUND_PAGE) {
        pages.add(`${prefix}${entry.name.slice(0, -PAGE_SUFFIX.length)}`);
      }
    }
  };
  walk(outDir, "/");
  return pages;
}

/**
 * Whether one request keeps the rule.
 *
 * Side effects: none.
 *
 * @param {{method: string, url: string, hasBody: boolean}} request The request as recorded.
 * @param {string} origin The app's origin, e.g. "http://127.0.0.1:4000".
 * @param {Set<string>} pages The app's pages, from app_pages.
 * @returns {boolean} True for a GET to the origin, or a HEAD to one of its pages; never with a body.
 */
export function request_allowed(request, origin, pages) {
  const url = new URL(request.url);
  if (url.origin !== origin || request.hasBody) return false;
  if (request.method === "GET") return true;
  const route = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  return request.method === "HEAD" && pages.has(route);
}
