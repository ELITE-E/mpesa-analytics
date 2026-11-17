/** `href` scoped to an import, e.g. "/spending?import=7"; unchanged without one. */
export function withImport(href: string, importId: number | null | undefined) {
  if (!importId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}import=${importId}`;
}

/** Parse an `?import=<id>` value; null when absent or not a positive id. */
export function parseImportId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}
