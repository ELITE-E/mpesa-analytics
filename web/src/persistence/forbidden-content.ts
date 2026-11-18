// What the vault never stores (ADR 0016, N-13): PDF bytes, the PDF password, the verification
// token, the account digest, the mobile number, the customer's name and email addresses. The vault
// refuses a ledger that holds any of them rather than dropping fields quietly, so a caller that
// builds ledgers carelessly fails loudly in tests. Pure: no storage.
//
// Fields are recognised by name; PDF bytes, other binary values and email addresses are also
// recognised by value. A mobile number or a name written into free text under an ordinary field
// cannot be told from a counterparty's, so the ledger builder must copy only the fields it means
// to keep (docs/THREAT_MODEL.md).

/** Which kind of forbidden content was found: never the value itself. */
export type ForbiddenContent =
  | "pdf_bytes"
  | "binary"
  | "pdf_password"
  | "verification_token"
  | "account_digest"
  | "mobile_number"
  | "customer_name"
  | "email";

/** Field names (lower case, letters and digits only) that hold forbidden content. */
const FORBIDDEN_FIELD_NAMES: Record<string, ForbiddenContent> = {
  pdfbytes: "pdf_bytes",
  pdf: "pdf_bytes",
  password: "pdf_password",
  pdfpassword: "pdf_password",
  passphrase: "pdf_password",
  verificationtoken: "verification_token",
  accountdigest: "account_digest",
  mobilenumber: "mobile_number",
  mobile: "mobile_number",
  msisdn: "mobile_number",
  phonenumber: "mobile_number",
  phone: "mobile_number",
  customername: "customer_name",
  accountname: "customer_name",
  accountholder: "customer_name",
  email: "email",
  emailaddress: "email",
};

const PDF_SIGNATURE = "%PDF";
// An address is recognised at each "@": one address character before it, and a domain with a dot
// after it, matched in place (sticky). Matching a pattern over the whole text instead backtracks
// quadratically on long unbroken text and froze the page.
const EMAIL_CHARACTER = /[^\s@<>()[\]"']/;
const EMAIL_DOMAIN_AT = /[^\s@<>()[\]"']{1,230}\.[a-z]{2,24}/iy;

/**
 * The first forbidden content found anywhere inside a ledger, depth first.
 *
 * @param ledger The ledger about to be saved.
 * @returns The kind of content found, or null when the ledger may be stored. Side effects: none.
 */
export function findForbiddenContent(ledger: unknown): ForbiddenContent | null {
  if (typeof ledger === "string") return forbiddenText(ledger);
  if (isBinary(ledger)) return startsWithPdfSignature(ledger) ? "pdf_bytes" : "binary";
  if (Array.isArray(ledger)) return firstFound(ledger);
  if (ledger !== null && typeof ledger === "object") {
    for (const [fieldName, nested] of Object.entries(ledger)) {
      const byName = FORBIDDEN_FIELD_NAMES[fieldName.toLowerCase().replace(/[^a-z0-9]/g, "")];
      if (byName) return byName;
      const found = findForbiddenContent(nested);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The first forbidden content among several values.
 *
 * @param values The values.
 * @returns The first kind found, or null. Side effects: none.
 */
function firstFound(values: unknown[]): ForbiddenContent | null {
  for (const nested of values) {
    const found = findForbiddenContent(nested);
    if (found) return found;
  }
  return null;
}

/**
 * Forbidden content recognised in a text value: PDF bytes decoded as text, or an email address.
 *
 * @param text The text.
 * @returns The kind found, or null. Side effects: none.
 */
function forbiddenText(text: string): ForbiddenContent | null {
  if (text.trimStart().startsWith(PDF_SIGNATURE)) return "pdf_bytes";
  if (holdsEmailAddress(text)) return "email";
  return null;
}

/**
 * Whether a text holds an email address. The cost grows with the number of "@" signs, each
 * checked in place, never with the length of the text.
 *
 * @param text The text.
 * @returns True if an address is found. Side effects: none.
 */
function holdsEmailAddress(text: string): boolean {
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (at === 0 || !EMAIL_CHARACTER.test(text[at - 1])) continue;
    EMAIL_DOMAIN_AT.lastIndex = at + 1;
    if (EMAIL_DOMAIN_AT.test(text)) return true;
  }
  return false;
}

/**
 * Whether a value is binary: an ArrayBuffer, a typed array or DataView, or a Blob.
 *
 * @param value The value.
 * @returns True for binary values. Side effects: none.
 */
function isBinary(value: unknown): value is ArrayBuffer | ArrayBufferView | Blob {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

/**
 * Whether binary bytes begin with the PDF signature. A Blob's bytes cannot be read synchronously,
 * so a Blob counts as plain binary.
 *
 * @param value The binary value.
 * @returns True if its first bytes are "%PDF". Side effects: none.
 */
function startsWithPdfSignature(value: ArrayBuffer | ArrayBufferView | Blob): boolean {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) return false;
  const bytes =
    value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextDecoder().decode(bytes.subarray(0, PDF_SIGNATURE.length)) === PDF_SIGNATURE;
}
