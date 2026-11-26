// CP10b item 2: tools/release/check_deployed.mjs checks a deployed site and prints PASS or FAIL
// lines. Here it runs against a loopback host emulator that serves web/out with the generated host
// headers, joined across matching rules as the hosts do, once faithfully and once per fault: a
// changed header, a runtime file that differs from its manifest, a script or header naming another
// host, a missing service worker, and a file that differs from the release's sha256sums.txt.
//
// Needs the runtime and `npm run build --prefix web` first, and system Chrome. Run from the repo:
//   node --test --test-concurrency=1 tests/release/check_deployed.test.mjs

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

import { checkDeployed, HOST_REPORTING_NOTE } from "../../tools/release/check_deployed.mjs";
import { startHostEmulator } from "../../tools/release/host_emulator.mjs";
import { releaseSums } from "../../tools/release/release_checksums.mjs";

const REPO = join(import.meta.dirname, "../..");
const OUT = join(REPO, "web/out");
const CHECKS = [
  "headers",
  "app_checksums",
  "runtime_checksums",
  "no_third_party",
  "no_sitemap",
  "service_worker",
];
const LINE = /^(PASS|FAIL) [a-z_]+( |:|$)/;
const TIMEOUT_MS = 10 * 60 * 1000;
const RUNTIME_VERSION = JSON.parse(readFileSync(join(OUT, "runtime/current.json"), "utf8")).version;
const RUNTIME_FILE = `/runtime/${RUNTIME_VERSION}/pdfjs/pdf.min.mjs`;
const ALLOW_LIST = readFileSync(join(OUT, "sw-allow-list.js"), "utf8");
const STYLESHEET = ALLOW_LIST.match(/"path":"(\/_next\/static\/[^"]+\.css)"/)[1];
const BUNDLE = ALLOW_LIST.match(/"path":"(\/_next\/static\/[^"]+\.js)"/)[1];
const ROBOTS = "User-agent: *\nDisallow:\n";
// Cloudflare's network-error reporting headers, in the form it sends them (JSON with escaped "/").
const REPORTING_DOMAIN = "a.nel.cloudflare.com";
const CLOUDFLARE_REPORT_TO =
  '{"endpoints":[{"url":"https:\\/\\/a.nel.cloudflare.com\\/report\\/v4?s=AbC123"}],' +
  '"group":"cf-nel","max_age":604800}';
const CLOUDFLARE_NEL = '{"success_fraction":0,"report_to":"cf-nel","max_age":604800}';

const scratch = mkdtempSync(join(tmpdir(), "check-deployed-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Run the checker against the emulator, with an optional fault.
 *
 * @param {object} [fault] Passed to the emulator as `tamper`.
 * @param {object} [options] Passed to checkDeployed.
 * @returns {Promise<{check: string, ok: boolean, line: string}[]>} The checker's lines.
 */
async function checkWith(fault = {}, options = {}) {
  const site = await startHostEmulator({ outDir: OUT, host: "netlify", tamper: fault });
  try {
    return await checkDeployed(`${site.origin}/`, options);
  } finally {
    await site.close();
  }
}

/**
 * A header fault adding Report-To and NEL to every response, as the host does.
 *
 * @param {string} reportTo The Report-To value.
 * @param {string} nel The NEL value.
 * @returns {Function} The `headers` fault.
 */
function withReporting(reportTo, nel) {
  return (path, headers) => {
    headers.set("report-to", reportTo);
    headers.set("nel", nel);
  };
}

/**
 * The line of one check.
 *
 * @param {object[]} lines From checkDeployed.
 * @param {string} name The check's name.
 * @returns {object} Its line.
 */
function lineOf(lines, name) {
  const found = lines.find((line) => line.check === name);
  assert.ok(found, `no ${name} line`);
  return found;
}

test(
  "a faithful deployment passes every check, in PASS lines",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith();
    assert.deepEqual(
      lines.map((line) => line.check),
      CHECKS,
    );
    for (const line of lines) {
      assert.ok(line.ok, line.line);
      assert.match(line.line, LINE);
    }
  },
);

test(
  "a missing security header fails headers, naming the path and the header only",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith(
      {
        headers: (path, headers) =>
          path === "/overview" ? headers.delete("referrer-policy") : null,
      },
      { browser: false },
    );
    const headers = lineOf(lines, "headers");
    assert.equal(headers.ok, false);
    assert.match(headers.line, /\/overview/);
    assert.match(headers.line, /referrer-policy/i);
    assert.equal(headers.line.includes("no-referrer"), false, "values are not printed");
  },
);

test(
  "a wrong cache rule fails headers: HTML cached as immutable",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith(
      {
        headers: (path, headers) =>
          path === "/ledger"
            ? headers.set("cache-control", "public, max-age=31536000, immutable")
            : null,
      },
      { browser: false },
    );
    assert.equal(lineOf(lines, "headers").ok, false);
  },
);

test(
  "a runtime file that differs from the checksum manifest fails runtime_checksums",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith(
      {
        body: (path, bytes) =>
          path === RUNTIME_FILE ? Buffer.concat([bytes, Buffer.from("\n")]) : bytes,
      },
      { browser: false },
    );
    const runtime = lineOf(lines, "runtime_checksums");
    assert.equal(runtime.ok, false);
    assert.match(runtime.line, /pdf\.min\.mjs/);
  },
);

test(
  "a script from another host injected into a page fails no_third_party and app_checksums",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith(
      {
        body: (path, bytes) =>
          path === "/overview"
            ? Buffer.from(
                bytes
                  .toString("utf8")
                  .replace(
                    "</body>",
                    '<script src="https://beacon.example.net/b.js"></script></body>',
                  ),
              )
            : bytes,
      },
      { browser: false },
    );
    assert.equal(lineOf(lines, "no_third_party").ok, false);
    assert.match(lineOf(lines, "no_third_party").line, /\/overview/);
    assert.equal(lineOf(lines, "app_checksums").ok, false);
  },
);

test("a header naming another host fails no_third_party", { timeout: TIMEOUT_MS }, async () => {
  const lines = await checkWith(
    {
      headers: (path, headers) =>
        path === "/" ? headers.set("link", "<https://fonts.example.net>; rel=preconnect") : null,
    },
    { browser: false },
  );
  assert.equal(lineOf(lines, "no_third_party").ok, false);
});

test("a site that serves a sitemap fails no_sitemap", { timeout: TIMEOUT_MS }, async () => {
  const lines = await checkWith(
    { extra: { "/sitemap.xml": "<urlset></urlset>" } },
    { browser: false },
  );
  assert.equal(lineOf(lines, "no_sitemap").ok, false);
});

test(
  "a /robots.txt the host answers itself gets the generated no-cache rule and passes headers",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith({ extra: { "/robots.txt": ROBOTS } }, { browser: false });
    assert.ok(lineOf(lines, "headers").ok, lineOf(lines, "headers").line);
  },
);

test(
  "a /robots.txt served without no-cache fails headers, naming the path",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith(
      {
        extra: { "/robots.txt": ROBOTS },
        headers: (path, headers) =>
          path === "/robots.txt" ? headers.set("cache-control", "max-age=14400") : null,
      },
      { browser: false },
    );
    assert.equal(lineOf(lines, "headers").ok, false);
    assert.match(lineOf(lines, "headers").line, /\/robots\.txt cache-control/);
  },
);

for (const [form, reportTo] of [
  ["escaped", CLOUDFLARE_REPORT_TO],
  ["plain", CLOUDFLARE_REPORT_TO.replaceAll("\\/", "/")],
]) {
  test(
    `the host's Report-To and NEL (${form}), naming only its reporting domain, pass no_third_party with a NOTE line`,
    { timeout: TIMEOUT_MS },
    async () => {
      const lines = await checkWith(
        { headers: withReporting(reportTo, CLOUDFLARE_NEL) },
        { browser: false },
      );
      assert.ok(lineOf(lines, "no_third_party").ok, lineOf(lines, "no_third_party").line);
      const notes = lines.filter((entry) => entry.line.startsWith("NOTE"));
      assert.deepEqual(
        notes.map((entry) => entry.line),
        [HOST_REPORTING_NOTE],
      );
      assert.ok(notes[0].ok, "a NOTE is not a failure");
      assert.equal(
        lines.indexOf(notes[0]),
        lines.indexOf(lineOf(lines, "no_third_party")) + 1,
        "the NOTE follows no_third_party",
      );
    },
  );
}

for (const [label, reportTo, nel] of [
  [
    "Report-To naming another host",
    CLOUDFLARE_REPORT_TO.replace("a.nel.cloudflare.com", "reports.example.net"),
    CLOUDFLARE_NEL,
  ],
  [
    "Report-To naming a look-alike of the reporting domain",
    CLOUDFLARE_REPORT_TO.replace("a.nel.cloudflare.com", "a.nel.cloudflare.com.example.net"),
    CLOUDFLARE_NEL,
  ],
  [
    "Report-To naming another subdomain of the host",
    CLOUDFLARE_REPORT_TO.replace("a.nel.cloudflare.com", "b.nel.cloudflare.com"),
    CLOUDFLARE_NEL,
  ],
  [
    "NEL naming another host",
    CLOUDFLARE_REPORT_TO,
    '{"report_to":"cf-nel","url":"https:\\/\\/reports.example.net\\/"}',
  ],
]) {
  test(`${label} fails no_third_party`, { timeout: TIMEOUT_MS }, async () => {
    const lines = await checkWith({ headers: withReporting(reportTo, nel) }, { browser: false });
    assert.equal(lineOf(lines, "no_third_party").ok, false);
    assert.match(lineOf(lines, "no_third_party").line, /header (report-to|nel)/);
  });
}

test(
  "the reporting domain in any other header fails no_third_party",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith(
      {
        headers: (path, headers) =>
          path === "/"
            ? headers.set("link", `<https://${REPORTING_DOMAIN}/x>; rel=preconnect`)
            : null,
      },
      { browser: false },
    );
    assert.equal(lineOf(lines, "no_third_party").ok, false);
    assert.match(lineOf(lines, "no_third_party").line, /\/ header link/);
  },
);

test(
  "the reporting domain in a page, a stylesheet, the service worker, a bundle or a runtime file fails",
  { timeout: TIMEOUT_MS },
  async () => {
    const url = `https://${REPORTING_DOMAIN}/report/v4`;
    for (const [path, check] of [
      ["/overview", "no_third_party"],
      [STYLESHEET, "no_third_party"],
      ["/sw.js", "no_third_party"],
      [BUNDLE, "app_checksums"],
      [RUNTIME_FILE, "runtime_checksums"],
    ]) {
      const lines = await checkWith(
        {
          body: (served, bytes) =>
            served === path ? Buffer.concat([bytes, Buffer.from(`\n/* ${url} */\n`)]) : bytes,
        },
        { browser: false },
      );
      assert.equal(lineOf(lines, check).ok, false, `${path}: ${check}`);
      assert.equal(
        lines.some((entry) => entry.line.startsWith("NOTE")),
        false,
        `${path}: no NOTE without the headers`,
      );
    }
  },
);

test(
  "without its service worker the site fails service_worker",
  { timeout: TIMEOUT_MS },
  async () => {
    const lines = await checkWith({ missing: ["/sw.js"] });
    assert.equal(lineOf(lines, "service_worker").ok, false);
  },
);

test(
  "with --sums, every file must match the release's sha256sums.txt",
  { timeout: TIMEOUT_MS },
  async () => {
    const sums = join(scratch, "sha256sums.txt");
    writeFileSync(sums, releaseSums(OUT));
    const good = await checkWith({}, { browser: false, sums });
    assert.ok(lineOf(good, "release_checksums").ok, lineOf(good, "release_checksums").line);
    const changed = releaseSums(OUT).replace(/^[0-9a-f]{64}(?=  sw\.js$)/m, "0".repeat(64));
    writeFileSync(sums, changed);
    const bad = await checkWith({}, { browser: false, sums });
    assert.equal(lineOf(bad, "release_checksums").ok, false);
    assert.match(lineOf(bad, "release_checksums").line, /sw\.js/);
  },
);

test(
  "the command prints PASS lines and exits 0 for a faithful site, FAIL and 1 for a faulty one",
  { timeout: TIMEOUT_MS },
  async () => {
    const run = promisify(execFile);
    const script = join(REPO, "tools/release/check_deployed.mjs");
    const good = await startHostEmulator({ outDir: OUT, host: "cloudflare-pages" });
    try {
      const { stdout } = await run(process.execPath, [script, `${good.origin}/`], {
        timeout: TIMEOUT_MS,
      });
      const printed = stdout.trim().split("\n");
      assert.ok(
        printed.every((line) => LINE.test(line) || /^check_deployed: (PASS|FAIL)/.test(line)),
        stdout,
      );
      assert.ok(
        printed.some((line) => line.startsWith("PASS service_worker")),
        stdout,
      );
    } finally {
      await good.close();
    }
    const bad = await startHostEmulator({
      outDir: OUT,
      host: "netlify",
      tamper: { missing: ["/sw.js"] },
    });
    try {
      await assert.rejects(
        run(process.execPath, [script, `${bad.origin}/`], { timeout: TIMEOUT_MS }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stdout, /^FAIL service_worker/m);
          return true;
        },
      );
    } finally {
      await bad.close();
    }
  },
);

test("an address that is not a URL is refused with a usage line", async () => {
  const run = promisify(execFile);
  await assert.rejects(
    run(process.execPath, [join(REPO, "tools/release/check_deployed.mjs"), "not a url"]),
    (error) => {
      assert.equal(error.code, 2);
      return true;
    },
  );
});
