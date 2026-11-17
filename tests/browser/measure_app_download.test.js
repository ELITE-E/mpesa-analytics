// tools/measure_app_download.mjs (CP8b item 7, the honest measure): a recorded first visit lists
// what the browser really downloaded from the app, each path once: the pages it opened, Next's
// chunks, the engine and the runtime, and never the host's _headers file.
// Needs the runtime and the app built (npm run build in web/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const REPO = join(import.meta.dirname, "../..");
const TOOL = join(REPO, "tools/measure_app_download.mjs");
const OUT = join(REPO, "web/out");

test("a recorded visit lists the files it downloaded, each once, all from the export", () => {
  const completed = spawnSync(process.execPath, [TOOL], { encoding: "utf8", timeout: 900_000 });
  assert.equal(completed.status, 0, completed.stderr);
  const fetched = JSON.parse(completed.stdout);
  assert.deepEqual(fetched, [...new Set(fetched)].sort());
  // Pages opened by address come as HTML; pages the app moves to come as their data file.
  for (const path of ["/", "/upload/"]) assert.ok(fetched.includes(path), path);
  assert.ok(
    fetched.some((path) => /^\/processing.*\.txt$/.test(path)),
    "the processing page's data",
  );
  assert.ok(fetched.some((path) => path.startsWith("/_next/static/")));
  assert.ok(fetched.includes("/pdf_reader/reader.worker.js"));
  assert.ok(fetched.some((path) => path.startsWith("/runtime/")));
  assert.equal(fetched.includes("/_headers"), false);
  for (const path of fetched) {
    const file = join(OUT, path);
    const page = [file, `${file}.html`, join(file, "index.html")];
    assert.ok(
      page.some((candidate) => existsSync(candidate)),
      path,
    );
  }
});
