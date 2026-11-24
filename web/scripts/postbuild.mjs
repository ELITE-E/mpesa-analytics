#!/usr/bin/env node
// After `next build` (static export): ships the statement engine with the app, drops what must not
// ship, writes the service worker's allow-list, and writes the host's headers (out/_headers) with
// one hash-based CSP for every response (CP8b item 1, CP10b item 1; ADR 0015, ADR 0019). The host
// comes from DEPLOY_HOST (cloudflare-pages or netlify); without it, Netlify's form, which has no
// host-only lines, so the local test server reads the same rules.
//   node scripts/postbuild.mjs
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

import { writeHostHeaders } from "./host_headers.mjs";
import { allowListScript, buildAllowList } from "./sw_allow_list.mjs";

const WEB = join(import.meta.dirname, "..");
const OUT = join(WEB, "out");
const ENGINE = join(WEB, "../pdf_reader");
const PLAIN_HOST = "netlify";

main();

/**
 * Ship the engine, drop dev-only files, and write the allow-list and the headers.
 *
 * Side effects: writes and deletes inside out/; exits if the runtime was not built.
 */
function main() {
  if (!existsSync(join(OUT, "runtime", "current.json"))) {
    console.error("postbuild: the runtime is missing; run tools/vendor.py runtime first");
    process.exit(1);
  }
  // public/vendor holds dev-only files (the Node build of pdf.js, test wheels); never shipped.
  rmSync(join(OUT, "vendor"), { recursive: true, force: true });
  // public/.gitkeep only keeps the folder in git. A host may refuse to serve a dotfile, and the
  // service worker would then fail to precache it, so it never ships.
  rmSync(join(OUT, ".gitkeep"), { force: true });
  cpSync(ENGINE, join(OUT, "pdf_reader"), {
    recursive: true,
    filter: (source) => !source.includes(`${sep}.`) && !source.endsWith(".gitkeep"),
  });
  // The service worker's allow-list, from every shipped file's checksum (CP10a item 4); written
  // after the engine is copied in, so pdf_reader/ is listed too.
  writeFileSync(join(OUT, "sw-allow-list.js"), allowListScript(buildAllowList(OUT)));
  const host = process.env.DEPLOY_HOST || PLAIN_HOST;
  const rules = writeHostHeaders(OUT, host)
    .split("\n")
    .filter((line) => /^\S/.test(line));
  console.log(`postbuild: ${rules.length} header rules for ${host}`);
}
