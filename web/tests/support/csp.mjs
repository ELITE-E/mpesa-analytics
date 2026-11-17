// Minimal Content-Security-Policy evaluation for contract tests: parse a
// policy, apply the CSP Level 3 directive fallbacks, and decide whether a
// given script, stylesheet or connection would be allowed. Deliberately
// small; it covers the source expressions this app can need and treats
// anything it does not understand as not allowed.

import { createHash } from "node:crypto";

const FALLBACKS = {
  "script-src-elem": ["script-src-elem", "script-src", "default-src"],
  "script-src-attr": ["script-src-attr", "script-src", "default-src"],
  "script-src": ["script-src", "default-src"],
  "style-src-elem": ["style-src-elem", "style-src", "default-src"],
  "style-src-attr": ["style-src-attr", "style-src", "default-src"],
  "style-src": ["style-src", "default-src"],
  "connect-src": ["connect-src", "default-src"],
  "font-src": ["font-src", "default-src"],
  "img-src": ["img-src", "default-src"],
  "object-src": ["object-src", "default-src"],
  "frame-src": ["frame-src", "child-src", "default-src"],
  "worker-src": ["worker-src", "child-src", "script-src", "default-src"],
  "manifest-src": ["manifest-src", "default-src"],
};

/** Parse one serialized policy into a Map of directive name to source list. */
export function parseCsp(header) {
  const directives = new Map();
  for (const part of header.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (!name) continue;
    const key = name.toLowerCase();
    // Per spec, only the first occurrence of a directive counts.
    if (!directives.has(key)) directives.set(key, sources);
  }
  return directives;
}

/**
 * The sources that govern `directive` after fallbacks, or null when neither
 * the directive nor any fallback is present (i.e. unrestricted).
 */
export function effectiveSources(policy, directive) {
  for (const name of FALLBACKS[directive] ?? [directive]) {
    if (policy.has(name)) return policy.get(name);
  }
  return null;
}

/** True for a keyword source such as 'self' (case-insensitive). */
function isKeyword(source, keyword) {
  return source.toLowerCase() === `'${keyword}'`;
}

/** True if `sources` contains the given keyword. */
export function hasKeyword(sources, keyword) {
  return (sources ?? []).some((source) => isKeyword(source, keyword));
}

/** Nonce and hash sources ('nonce-…', 'sha256-…') in a source list. */
export function nonceAndHashSources(sources) {
  return (sources ?? []).filter((source) => /^'(nonce|sha256|sha384|sha512)-/i.test(source));
}

/**
 * Whether a host or scheme source expression matches `url` (CSP3 §6.7.2,
 * simplified): scheme-only, host with optional `*.` prefix, port and path.
 */
function hostSourceMatches(source, url, appOrigin) {
  if (source === "*") return true;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
    return url.protocol === source.toLowerCase();
  }
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i.exec(source);
  if (!match) return false;
  const [, scheme, wildcard, host, port, path] = match;
  const app = new URL(appOrigin);
  const wantedScheme = (scheme ?? app.protocol.slice(0, -1)).toLowerCase();
  const actualScheme = url.protocol.slice(0, -1);
  const schemeOk =
    wantedScheme === actualScheme ||
    (wantedScheme === "http" && actualScheme === "https") ||
    (wantedScheme === "ws" && actualScheme === "wss");
  if (!schemeOk) return false;
  const hostname = url.hostname.toLowerCase();
  const wantedHost = host.toLowerCase();
  const hostOk = wildcard ? hostname.endsWith(`.${wantedHost}`) : hostname === wantedHost;
  if (!hostOk) return false;
  if (port !== "*") {
    const defaultPort = { http: "80", https: "443", ws: "80", wss: "443" }[actualScheme];
    const wantedPort = port ?? { http: "80", https: "443", ws: "80", wss: "443" }[wantedScheme];
    if ((url.port || defaultPort) !== wantedPort) return false;
  }
  if (path && path !== "/") {
    return path.endsWith("/") ? url.pathname.startsWith(path) : url.pathname === path;
  }
  return true;
}

/** Whether a source list allows fetching `url` from a page on `appOrigin`. */
export function sourcesAllowUrl(sources, url, appOrigin) {
  if (sources === null) return true;
  const target = new URL(url, appOrigin);
  return sources.some((source) => {
    if (isKeyword(source, "self")) {
      if (target.origin === appOrigin) return true;
      // CSP3: 'self' also matches ws(s) to the same host and port.
      const app = new URL(appOrigin);
      return /^wss?:$/.test(target.protocol) && target.host === app.host;
    }
    if (source.startsWith("'")) return false;
    return hostSourceMatches(source, target, appOrigin);
  });
}

/** CSP hash source ('sha256-…') for an inline script or style body. */
export function hashSource(text, algorithm = "sha256") {
  return `'${algorithm}-${createHash(algorithm).update(text, "utf8").digest("base64")}'`;
}

/** Whether `sources` lists a hash of `text` in any supported algorithm. */
function sourcesListHashOf(sources, text) {
  return ["sha256", "sha384", "sha512"].some((algorithm) =>
    sources.includes(hashSource(text, algorithm)),
  );
}

/**
 * Whether a <script> element (from parseScripts) would execute under the
 * policy, following CSP3: nonces and hashes first, then 'strict-dynamic'
 * (which disables host sources and 'unsafe-inline'), then the rest.
 */
export function scriptAllowed(policy, script, appOrigin) {
  const sources = effectiveSources(policy, "script-src-elem");
  if (sources === null) return true;
  if (script.nonce && sources.includes(`'nonce-${script.nonce}'`)) return true;
  const hasNonceOrHash = nonceAndHashSources(sources).length > 0;
  const strictDynamic = hasKeyword(sources, "strict-dynamic");
  if (script.src === null) {
    if (sourcesListHashOf(sources, script.text)) return true;
    return hasKeyword(sources, "unsafe-inline") && !hasNonceOrHash && !strictDynamic;
  }
  if (strictDynamic) return false;
  return sourcesAllowUrl(sources, script.src, appOrigin);
}

/** Whether an inline style attribute value is allowed by the policy. */
export function styleAttributeAllowed(policy, value) {
  const sources = effectiveSources(policy, "style-src-attr");
  if (sources === null) return true;
  if (hasKeyword(sources, "unsafe-hashes") && sourcesListHashOf(sources, value)) return true;
  return hasKeyword(sources, "unsafe-inline") && nonceAndHashSources(sources).length === 0;
}

/** Whether an inline <style> element is allowed by the policy. */
export function styleElementAllowed(policy, style) {
  const sources = effectiveSources(policy, "style-src-elem");
  if (sources === null) return true;
  if (style.nonce && sources.includes(`'nonce-${style.nonce}'`)) return true;
  if (sourcesListHashOf(sources, style.text)) return true;
  return hasKeyword(sources, "unsafe-inline") && nonceAndHashSources(sources).length === 0;
}

/** Decode the few HTML entities React emits inside attribute values. */
function decodeAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/** Attributes of one start tag as a Map (names lower-cased, values decoded). */
export function parseAttributes(attributeText) {
  const attributes = new Map();
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const [, name, double, single, bare] of attributeText.matchAll(pattern)) {
    attributes.set(name.toLowerCase(), decodeAttribute(double ?? single ?? bare ?? ""));
  }
  return attributes;
}

/** Every <script> in an HTML document: { src, nonce, text, attributes }. */
export function parseScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([, attrs, text]) => {
    const attributes = parseAttributes(attrs);
    return {
      src: attributes.get("src") ?? null,
      nonce: attributes.get("nonce") ?? null,
      text,
      attributes,
    };
  });
}

/** Every inline <style> element: { nonce, text }. */
export function parseStyleElements(html) {
  return [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)].map(([, attrs, text]) => {
    const attributes = parseAttributes(attrs);
    return { nonce: attributes.get("nonce") ?? null, text };
  });
}

/** Every inline style="…" attribute value. */
export function parseStyleAttributes(html) {
  return [...html.matchAll(/<[a-z][^>]*?\sstyle="([^"]*)"/gi)].map(([, value]) =>
    decodeAttribute(value),
  );
}

/** Every <link> element's attributes. */
export function parseLinks(html) {
  return [...html.matchAll(/<link\b([^>]*)>/gi)].map(([, attrs]) => parseAttributes(attrs));
}
