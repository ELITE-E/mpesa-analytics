// Frontend security header and CSP contracts (FRONTEND-SEC-01, -02, -04,
// and the HTTP-observable parts of -03), asserted on real HTTP responses
// from the production standalone server and from `next dev`.
//
// Intended policy, derived from the app as built (see the report for the
// inspection behind it):
//
//   * Every HTML page carries inline Next.js flight scripts
//     (`self.__next_f.push(…)`), so script-src needs a per-request nonce or
//     hashes for them; 'unsafe-inline' alone, 'unsafe-eval' and broad
//     sources are not acceptable in production.
//   * Icons use inline style="…" attributes and the layout loads the
//     Material Symbols stylesheet from https://fonts.googleapis.com, whose
//     font files come from https://fonts.gstatic.com.
//   * The browser talks to exactly two origins: this app (RSC navigation
//     requests) and NEXT_PUBLIC_API_BASE_URL.
//   * The app is never meant to be framed; it has no plugins; the login
//     form submits only to itself.
//   * Production runs behind TLS-terminating hosting (Render), so "served
//     over HTTPS" arrives as `X-Forwarded-Proto: https`.
//
// What these tests cannot prove: that a browser actually enforces the
// policy and the app still hydrates under it. They evaluate the served
// policy against the served HTML (every script, style and stylesheet) and
// the bundle's API origin; a browser-level test is still needed (see the
// report).
//
// Run from web-prototype/ (builds a throwaway copy; takes a few minutes):
//   node --test --test-concurrency=1 tests/frontend-security-headers.test.mjs

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  effectiveSources,
  hasKeyword,
  nonceAndHashSources,
  parseAttributes,
  parseCsp,
  parseLinks,
  parseScripts,
  parseStyleAttributes,
  parseStyleElements,
  scriptAllowed,
  sourcesAllowUrl,
  styleAttributeAllowed,
  styleElementAllowed,
} from "./support/csp.mjs";
import {
  buildForProduction,
  copyAppToTempDir,
  removeTempDir,
  startDevelopmentServer,
  startProductionServer,
} from "./support/frontend-server.mjs";

const PRODUCTION_API_ORIGIN = "https://api.app.test";
// From web-prototype/.env.development, which `next dev` loads.
const DEVELOPMENT_API_ORIGIN = "http://localhost:8000";
const GOOGLE_FONTS_STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILE_ORIGIN = "https://fonts.gstatic.com";
const HSTS_MIN_MAX_AGE = 31_536_000; // one year
const ACCEPTED_REFERRER_POLICIES = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);
const SENTINEL = "sentinel-token-FRONTEND-SEC-0f4e";
const OVER_HTTPS = { "x-forwarded-proto": "https" };

// HTML documents that must carry the full header set.
const PRODUCTION_DOCUMENTS = [
  { path: "/", status: 200, note: "home (static)" },
  { path: "/login", status: 200, note: "login (dynamic)" },
  { path: "/login?next=%2Foverview", status: 200, note: "login with return path" },
  { path: "/upload", status: 200, note: "upload (static)" },
  { path: "/overview", status: 200, note: "protected page" },
  { path: "/does-not-exist", status: 404, note: "not-found error page" },
  // Stage 8b (Q-R1): an old area URL is a permanent redirect answered by the app.
  { path: "/spending?import=7", status: 308, note: "old area URL, redirect" },
];

// Non-canonical paths that Next answers with its own normalization
// redirects today. `appControlled` says whether the app can attach headers
// to whatever answers them: the trailing-slash redirect can be handed to
// the app (skipTrailingSlashRedirect), but Next's repeated-slash redirect is
// issued inside its router before next.config headers() and proxy.ts run,
// so only an edge layer in front of Next could add headers to it.
const NON_CANONICAL_PATHS = [
  { path: "/login/", appControlled: true },
  { path: "//example.invalid", appControlled: false },
];

const DEVELOPMENT_DOCUMENTS = [
  { path: "/", status: 200, note: "home" },
  { path: "/login", status: 200, note: "login" },
];

let appDir;
let production;
let development;

before(
  async () => {
    appDir = copyAppToTempDir();
    await buildForProduction(appDir, PRODUCTION_API_ORIGIN);
    production = await startProductionServer(appDir);
  },
  { timeout: 600_000 },
);

after(async () => {
  await development?.stop();
  await production?.stop();
  removeTempDir(appDir);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** GET `path` from a running server without following redirects. */
async function get(server, path, headers = {}) {
  const response = await fetch(`${server.origin}${path}`, { headers, redirect: "manual" });
  const body = await response.text();
  return { response, body, headers: response.headers };
}

/**
 * The single enforced CSP of a response, parsed. Fails when the header is
 * missing, only report-only, or sent as several competing policies.
 */
function singlePolicy(headers, where) {
  const header = headers.get("content-security-policy");
  assert.ok(
    header,
    `${where}: no Content-Security-Policy header` +
      (headers.get("content-security-policy-report-only") ? " (only report-only)" : ""),
  );
  const policies = header.split(",").map((policy) => policy.trim()).filter(Boolean);
  assert.equal(policies.length, 1, `${where}: expected one CSP, got ${policies.length}`);
  return parseCsp(policies[0]);
}

/** The policy with nonce values blanked, for comparing across responses. */
function policyShape(policy) {
  return [...policy.entries()]
    .map(([name, sources]) =>
      [name, ...sources.map((source) => source.replace(/^'nonce-.*'$/i, "'nonce-*'"))].join(" "),
    )
    .sort()
    .join("; ");
}

/** Assert headers every response must carry (or lack), whatever its type. */
function assertBaselineHeaders(headers, where, { https }) {
  assert.equal(headers.get("x-content-type-options"), "nosniff", `${where}: X-Content-Type-Options`);
  assert.equal(headers.get("x-powered-by"), null, `${where}: X-Powered-By must not be sent`);
  if (https) assertHsts(headers, where);
}

/** Assert a Strict-Transport-Security header of at least a year. */
function assertHsts(headers, where) {
  const hsts = headers.get("strict-transport-security");
  assert.ok(hsts, `${where}: no Strict-Transport-Security over HTTPS`);
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1]);
  assert.ok(maxAge >= HSTS_MIN_MAX_AGE, `${where}: HSTS max-age ${maxAge} < ${HSTS_MIN_MAX_AGE}`);
}

/** Assert the document-level headers besides CSP (referrer, framing). */
function assertDocumentHeaders(headers, where, options) {
  assertBaselineHeaders(headers, where, options);
  const referrerPolicy = headers.get("referrer-policy");
  assert.ok(
    referrerPolicy && referrerPolicy.split(",").every((value) => ACCEPTED_REFERRER_POLICIES.has(value.trim())),
    `${where}: Referrer-Policy ${JSON.stringify(referrerPolicy)} is not one of ${[...ACCEPTED_REFERRER_POLICIES]}`,
  );
  const policy = singlePolicy(headers, where);
  const frameAncestors = policy.get("frame-ancestors");
  const frameOptions = headers.get("x-frame-options")?.toUpperCase();
  assert.ok(
    (frameAncestors && isOnly(frameAncestors, ["'none'", "'self'"])) ||
      frameOptions === "DENY" ||
      frameOptions === "SAMEORIGIN",
    `${where}: no frame protection (frame-ancestors or X-Frame-Options)`,
  );
}

/** True when every source is one of `allowed` (case-insensitive) and there is at least one. */
function isOnly(sources, allowed) {
  const lower = allowed.map((source) => source.toLowerCase());
  return sources.length > 0 && sources.every((source) => lower.includes(source.toLowerCase()));
}

/** Directives with a wildcard or bare-scheme source that is not explicitly tolerated. */
function broadSources(policy, tolerated = {}) {
  const findings = [];
  for (const [name, sources] of policy) {
    for (const source of sources) {
      const isWildcard = source === "*" || source.includes("*.") || /:\*$/.test(source);
      const isScheme = /^[a-z][a-z0-9+.-]*:$/i.test(source);
      if ((isWildcard || isScheme) && !(tolerated[name] ?? []).includes(source.toLowerCase())) {
        findings.push(`${name} ${source}`);
      }
    }
  }
  return findings;
}

/**
 * Assert the directive-level CSP contract. `mode` is "production" or
 * "development"; the only differences are 'unsafe-eval' (React's dev
 * tooling needs it) and which API origin connect-src must allow.
 */
function assertPolicyContract(policy, where, { mode, appOrigin, apiOrigin }) {
  const defaultSrc = policy.get("default-src");
  assert.ok(defaultSrc && isOnly(defaultSrc, ["'self'", "'none'"]), `${where}: default-src must be 'self' or 'none'`);

  for (const directive of ["script-src", "script-src-elem"]) {
    const sources = effectiveSources(policy, directive);
    assert.ok(sources, `${where}: scripts unrestricted`);
    const strictDynamic = hasKeyword(sources, "strict-dynamic");
    const noncesOrHashes = nonceAndHashSources(sources).length > 0;
    assert.ok(
      !hasKeyword(sources, "unsafe-inline") || noncesOrHashes,
      `${where}: ${directive} relies on 'unsafe-inline' without a nonce or hash`,
    );
    if (mode === "production") {
      assert.ok(!hasKeyword(sources, "unsafe-eval"), `${where}: ${directive} allows 'unsafe-eval' in production`);
    }
    assert.ok(!hasKeyword(sources, "wasm-unsafe-eval"), `${where}: ${directive} allows 'wasm-unsafe-eval'`);
    for (const source of sources) {
      const lower = source.toLowerCase();
      assert.ok(!["data:", "blob:", "*"].includes(lower), `${where}: ${directive} allows ${source}`);
      if (lower === "https:" || lower === "http:") {
        assert.ok(strictDynamic, `${where}: ${directive} allows ${source} without 'strict-dynamic'`);
      }
    }
  }

  const objectSrc = effectiveSources(policy, "object-src");
  assert.ok(objectSrc && isOnly(objectSrc, ["'none'"]), `${where}: object-src must be 'none'`);

  const baseUri = policy.get("base-uri");
  assert.ok(baseUri && isOnly(baseUri, ["'self'", "'none'"]), `${where}: base-uri must be 'self' or 'none'`);

  const frameAncestors = policy.get("frame-ancestors");
  assert.ok(
    frameAncestors && isOnly(frameAncestors, ["'none'", "'self'"]),
    `${where}: frame-ancestors must be 'none' or 'self'`,
  );

  const formAction = policy.get("form-action");
  assert.ok(formAction && isOnly(formAction, ["'self'", "'none'"]), `${where}: form-action must be 'self' or 'none'`);

  const connect = effectiveSources(policy, "connect-src");
  assert.ok(connect, `${where}: connect-src unrestricted`);
  assert.ok(sourcesAllowUrl(connect, `${apiOrigin}/api/v1/auth/login`, appOrigin), `${where}: connect-src blocks the API ${apiOrigin}`);
  assert.ok(sourcesAllowUrl(connect, `${appOrigin}/login`, appOrigin), `${where}: connect-src blocks the app's own origin`);
  if (mode === "production") {
    const extra = connect.filter((source) => !isKeyword(source, "self") && source.replace(/\/$/, "") !== apiOrigin);
    assert.deepEqual(extra, [], `${where}: connect-src allows more than this app and the API`);
  }

  assert.deepEqual(
    broadSources(policy, {
      "script-src": ["https:", "http:"],
      "script-src-elem": ["https:", "http:"],
      "img-src": ["data:", "blob:"],
      "font-src": ["data:"],
    }),
    [],
    `${where}: wildcard or scheme-wide sources`,
  );
}

/** True for one CSP keyword source, case-insensitively. */
function isKeyword(source, keyword) {
  return source.toLowerCase() === `'${keyword}'`;
}

/**
 * Assert the policy lets the page do what it needs: run every script it
 * contains, apply its inline styles, load its stylesheets and fonts.
 */
function assertPolicyAllowsPage(policy, html, where, appOrigin) {
  const blockedScripts = parseScripts(html)
    .filter((script) => !scriptAllowed(policy, script, appOrigin))
    .map((script) => script.src ?? `inline: ${script.text.slice(0, 50)}…`);
  assert.deepEqual(blockedScripts, [], `${where}: scripts the policy would block`);

  const blockedStyleElements = parseStyleElements(html).filter((style) => !styleElementAllowed(policy, style));
  assert.equal(blockedStyleElements.length, 0, `${where}: inline <style> elements the policy would block`);

  const styleAttributes = parseStyleAttributes(html);
  const blockedStyleAttributes = styleAttributes.filter((value) => !styleAttributeAllowed(policy, value));
  assert.deepEqual([...new Set(blockedStyleAttributes)], [], `${where}: style="" attributes the policy would block`);

  const links = parseLinks(html);
  const styleSources = effectiveSources(policy, "style-src-elem");
  const fontSources = effectiveSources(policy, "font-src");
  for (const link of links) {
    const rel = (link.get("rel") ?? "").toLowerCase();
    const href = link.get("href");
    if (!href) continue;
    if (rel === "stylesheet" || (rel === "preload" && link.get("as") === "style")) {
      assert.ok(sourcesAllowUrl(styleSources, href, appOrigin), `${where}: style-src blocks ${href}`);
    }
    if (rel === "preload" && link.get("as") === "font") {
      assert.ok(sourcesAllowUrl(fontSources, href, appOrigin), `${where}: font-src blocks ${href}`);
    }
    if (rel === "stylesheet" && new URL(href, appOrigin).origin === GOOGLE_FONTS_STYLESHEET_ORIGIN) {
      // Assumption: Google's stylesheet loads its font files from gstatic.
      assert.ok(
        sourcesAllowUrl(fontSources, `${GOOGLE_FONTS_FILE_ORIGIN}/s/materialsymbolsoutlined/v1/x.woff2`, appOrigin),
        `${where}: font-src blocks ${GOOGLE_FONTS_FILE_ORIGIN}, needed by ${href}`,
      );
    }
  }
}

/** Same-origin script chunk URLs referenced by an HTML document. */
function scriptChunks(html) {
  return parseScripts(html)
    .map((script) => script.src)
    .filter((src) => src && src.startsWith("/_next/static/"));
}

// ---------------------------------------------------------------------------
// FRONTEND-SEC-01 — required response headers (production)
// ---------------------------------------------------------------------------

describe("FRONTEND-SEC-01 production response headers", () => {
  for (const { path, status, note } of PRODUCTION_DOCUMENTS) {
    test(`${path} (${note}) over HTTPS carries the document header set`, async () => {
      const { response, headers } = await get(production, path, OVER_HTTPS);
      assert.equal(response.status, status);
      assertDocumentHeaders(headers, path, { https: true });
    });

    test(`${path} (${note}) over plain HTTP carries the same set, minus HSTS`, async () => {
      const { headers } = await get(production, path);
      assertDocumentHeaders(headers, path, { https: false });
    });
  }

  for (const { path, appControlled } of NON_CANONICAL_PATHS) {
    test(`non-canonical ${JSON.stringify(path)} never redirects off-site`, async () => {
      const { response, headers } = await get(production, path, OVER_HTTPS);
      assert.equal(headers.get("x-powered-by"), null, `${path}: X-Powered-By must not be sent`);
      if (response.status >= 300 && response.status < 400) {
        const location = new URL(headers.get("location"), production.origin);
        assert.equal(location.origin, production.origin, `Location leaves the app: ${location.href}`);
        assert.notEqual(`${location.pathname}${location.search}`, path, `${path} redirects to itself`);
        const refresh = /url=(.*)$/i.exec(headers.get("refresh") ?? "")?.[1];
        if (refresh) {
          const target = new URL(refresh.trim(), production.origin);
          assert.equal(target.origin, production.origin, `Refresh leaves the app: ${target.href}`);
        }
      }
    });

    if (appControlled) {
      test(`non-canonical ${JSON.stringify(path)} carries baseline headers`, async () => {
        const { headers } = await get(production, path, OVER_HTTPS);
        assertBaselineHeaders(headers, path, { https: true });
      });
    } else {
      test(`non-canonical ${JSON.stringify(path)} redirect is not served as HTML`, async () => {
        // Its headers are outside the app's control (see NON_CANONICAL_PATHS);
        // at least its body must not be renderable as a document.
        const { response, headers } = await get(production, path, OVER_HTTPS);
        assert.ok(response.status >= 300 && response.status < 400, `status ${response.status}`);
        assert.doesNotMatch(headers.get("content-type") ?? "", /html/i);
      });
    }
  }

  test("static script chunks carry baseline headers", async () => {
    const { body } = await get(production, "/login");
    const [chunk] = scriptChunks(body);
    assert.ok(chunk, "login page references no script chunk");
    const { response, headers } = await get(production, chunk, OVER_HTTPS);
    assert.equal(response.status, 200);
    assertBaselineHeaders(headers, chunk, { https: true });
  });

  test("favicon carries baseline headers", async () => {
    const { response, headers } = await get(production, "/favicon.ico", OVER_HTTPS);
    assert.equal(response.status, 200);
    assertBaselineHeaders(headers, "/favicon.ico", { https: true });
  });
});

// ---------------------------------------------------------------------------
// FRONTEND-SEC-02 — CSP correctness and effectiveness (production)
// ---------------------------------------------------------------------------

describe("FRONTEND-SEC-02 production CSP", () => {
  for (const { path, note } of PRODUCTION_DOCUMENTS) {
    test(`${path} (${note}) policy meets the directive contract`, async () => {
      const { headers } = await get(production, path, OVER_HTTPS);
      assertPolicyContract(singlePolicy(headers, path), path, {
        mode: "production",
        appOrigin: production.origin,
        apiOrigin: PRODUCTION_API_ORIGIN,
      });
    });

    test(`${path} (${note}) policy allows every script, style and font the page uses`, async () => {
      const { headers, body } = await get(production, path, OVER_HTTPS);
      assertPolicyAllowsPage(singlePolicy(headers, path), body, path, production.origin);
    });
  }

  test("page HTML really contains inline scripts (so a nonce/hash strategy is required)", async () => {
    const { body } = await get(production, "/");
    assert.ok(
      parseScripts(body).some((script) => script.src === null && script.text.includes("__next_f")),
      "expected inline Next.js flight scripts; if they are gone, revisit the policy rationale",
    );
  });

  for (const path of ["/", "/login"]) {
    test(`${path} nonces, if used, are fresh per response and unguessable`, async () => {
      const first = await get(production, path, OVER_HTTPS);
      const second = await get(production, path, OVER_HTTPS);
      const noncesOf = ({ headers }) =>
        nonceAndHashSources(effectiveSources(singlePolicy(headers, path), "script-src-elem"))
          .filter((source) => /^'nonce-/i.test(source))
          .map((source) => source.slice(7, -1));
      const [a, b] = [noncesOf(first), noncesOf(second)];
      for (const nonce of [...a, ...b]) {
        assert.ok(nonce.length >= 22, `nonce ${nonce} is shorter than 128 bits of base64`);
      }
      if (a.length || b.length) {
        assert.ok(!a.some((nonce) => b.includes(nonce)), `${path}: nonce reused across responses`);
      }
    });
  }

  test("the API origin compiled into the bundle is allowed by connect-src", async () => {
    const { headers, body } = await get(production, "/login", OVER_HTTPS);
    const chunks = await Promise.all(scriptChunks(body).map((chunk) => get(production, chunk)));
    assert.ok(
      chunks.some(({ body: source }) => source.includes(PRODUCTION_API_ORIGIN)),
      "login bundle does not reference the configured API origin",
    );
    const connect = effectiveSources(singlePolicy(headers, "/login"), "connect-src");
    assert.ok(sourcesAllowUrl(connect, `${PRODUCTION_API_ORIGIN}/api/v1/auth/login`, production.origin));
  });

  test("production bundles need no eval", async () => {
    const { body } = await get(production, "/login");
    for (const chunk of scriptChunks(body)) {
      const { body: source } = await get(production, chunk);
      assert.ok(!/\beval\(|new Function\(/.test(source), `${chunk} uses eval`);
    }
  });
});

// ---------------------------------------------------------------------------
// FRONTEND-SEC-03 — bearer token exposure, as observable over HTTP
// ---------------------------------------------------------------------------

describe("FRONTEND-SEC-03 tokens never reach server-rendered output", () => {
  for (const path of ["/", "/login", "/overview", "/does-not-exist"]) {
    test(`${path} does not reflect a token sent in headers or cookies`, async () => {
      const { headers, body } = await get(production, path, {
        authorization: `Bearer ${SENTINEL}`,
        cookie: `mpesa.session.token=${SENTINEL}; session=${SENTINEL}`,
      });
      assert.ok(!body.includes(SENTINEL), `${path}: token in HTML`);
      for (const [name, value] of headers) {
        assert.ok(!value.includes(SENTINEL), `${path}: token in response header ${name}`);
      }
    });
  }

  test("a login form submitted before hydration cannot put credentials in a URL", async () => {
    const { body } = await get(production, "/login");
    const form = /<form\b([^>]*)>([\s\S]*?)<\/form>/i.exec(body);
    assert.ok(form, "login page has no <form>");
    const formAttributes = parseAttributes(form[1]);
    const method = (formAttributes.get("method") ?? "get").toLowerCase();
    const action = formAttributes.get("action");
    if (action) {
      assert.equal(new URL(action, production.origin).origin, production.origin, "form posts off-site");
    }
    const namedInputs = [...form[2].matchAll(/<input\b([^>]*)>/gi)]
      .map(([, attrs]) => parseAttributes(attrs))
      .filter((attrs) => attrs.has("name"));
    assert.ok(
      method === "post" || namedInputs.length === 0,
      "a GET form with named inputs would put the username/password in the query string",
    );
  });
});

// ---------------------------------------------------------------------------
// FRONTEND-SEC-04 — regression and compatibility (production)
// ---------------------------------------------------------------------------

describe("FRONTEND-SEC-04 production compatibility", () => {
  for (const { path, status } of PRODUCTION_DOCUMENTS) {
    test(`${path} still renders`, async () => {
      const { response, body, headers } = await get(production, path, OVER_HTTPS);
      assert.equal(response.status, status);
      assert.match(headers.get("content-type") ?? "", /^text\/html/);
      assert.match(body, /<html[\s>]/);
    });
  }

  test("login page renders its form", async () => {
    const { body } = await get(production, "/login");
    assert.match(body, /Sign in/);
    assert.match(body, /type="password"/);
  });

  test("every script chunk of the login page is served as JavaScript", async () => {
    const { body } = await get(production, "/login");
    for (const chunk of scriptChunks(body)) {
      const { response, headers } = await get(production, chunk);
      assert.equal(response.status, 200, chunk);
      assert.match(headers.get("content-type") ?? "", /javascript/, chunk);
    }
  });

  test("all documents share one policy shape (only nonces may differ)", async () => {
    const shapes = new Map();
    for (const { path } of PRODUCTION_DOCUMENTS) {
      const { headers } = await get(production, path, OVER_HTTPS);
      shapes.set(path, policyShape(singlePolicy(headers, path)));
    }
    assert.equal(new Set(shapes.values()).size, 1, `policies differ:\n${[...shapes].join("\n")}`);
  });
});

// ---------------------------------------------------------------------------
// Development server: same contract except the explicit dev allowances
// ---------------------------------------------------------------------------

describe("FRONTEND-SEC-04 development differences", () => {
  before(
    async () => {
      development = await startDevelopmentServer(appDir);
    },
    { timeout: 300_000 },
  );

  after(async () => {
    await development?.stop();
    development = null;
  });

  for (const { path, status, note } of DEVELOPMENT_DOCUMENTS) {
    test(`dev ${path} (${note}) carries headers and a CSP (HSTS not required)`, { timeout: 180_000 }, async () => {
      const { response, headers } = await get(development, path);
      assert.equal(response.status, status);
      assertDocumentHeaders(headers, `dev ${path}`, { https: false });
      assertPolicyContract(singlePolicy(headers, `dev ${path}`), `dev ${path}`, {
        mode: "development",
        appOrigin: development.origin,
        apiOrigin: DEVELOPMENT_API_ORIGIN,
      });
    });

    test(`dev ${path} (${note}) policy allows the dev page's scripts and styles`, { timeout: 180_000 }, async () => {
      const { headers, body } = await get(development, path);
      assertPolicyAllowsPage(singlePolicy(headers, `dev ${path}`), body, `dev ${path}`, development.origin);
    });
  }
});
