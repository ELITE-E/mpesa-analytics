// The Ledger's URL contract (IA migration Stage 5, decision Q-R2): ?scope=
// names the rows (Stage 6 added money-in, money-out and bucket:<id> for
// Overview's doors), ?from= the screen that opened them (for the back link),
// ?import= the statement. Earlier links keep working through their legacy
// parameters. Identifiers, statement lines and ?paybill are not part of it
// (M-29, M-31, M-32).

import { withImport } from "@/lib/import-link";
import { isLedgerScopeId } from "@/lib/statement/scopes";

/** The screens a Ledger visit can return to, with their links. */
export const LEDGER_ORIGINS = {
  overview: { label: "Overview", href: "/overview" },
  spending: { label: "Spending", href: "/breakdown/spending" },
  people: { label: "People", href: "/breakdown/people" },
  savings: { label: "Savings & Investments", href: "/breakdown/savings" },
  cash: { label: "Cash", href: "/breakdown/cash" },
  "money-in": { label: "Money In", href: "/breakdown/money-in" },
  fees: { label: "Fees", href: "/breakdown/fees" },
  investments: { label: "Savings & Investments", href: "/breakdown/savings" },
  summary: { label: "Statement check", href: "/analysis-summary" },
  breakdown: { label: "Breakdown", href: "/breakdown" },
} as const;

export type LedgerOrigin = keyof typeof LEDGER_ORIGINS;

/** What a Ledger URL asks for: a scope id (null: every row), an origin, and whether a view was asked for that doesn't exist. */
export type LedgerRequest = { scopeId: string | null; from: LedgerOrigin | null; unrecognised: boolean };

export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a query parameter. */
function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || null;
}

/** The legacy ?filter values and the scopes they name. */
const LEGACY_FILTERS: Record<string, string> = { unmapped: "unclassified", fees: "fees", investments: "investments" };

/** The scope a URL's legacy parameters name, by precedence: receipt, then merchant, then filter. */
function legacyScope(params: SearchParams): { scopeId: string | null; unrecognised: boolean } {
  const receipt = single(params.receipt);
  if (receipt) return { scopeId: `receipt:${receipt}`, unrecognised: false };
  const merchant = single(params.merchant);
  if (merchant) return { scopeId: `entity:${merchant}`, unrecognised: false };
  const filter = single(params.filter);
  if (!filter) return { scopeId: null, unrecognised: false };
  const scopeId = LEGACY_FILTERS[filter] ?? null;
  return { scopeId, unrecognised: scopeId === null };
}

/**
 * What the Ledger URL `params` asks for. ?scope wins; otherwise the legacy
 * parameters map onto scopes (receipt, then merchant, then filter). A scope
 * or filter outside the vocabulary asks for every row and is flagged, so the
 * screen can say so instead of silently showing something else. ?from is
 * kept only when it names a known origin.
 */
export function ledgerRequest(params: SearchParams): LedgerRequest {
  const fromParam = single(params.from);
  const from = fromParam && fromParam in LEDGER_ORIGINS ? (fromParam as LedgerOrigin) : null;
  const scope = single(params.scope);
  if (scope) return isLedgerScopeId(scope) ? { scopeId: scope, from, unrecognised: false } : { scopeId: null, from, unrecognised: true };
  return { ...legacyScope(params), from };
}

/** The Ledger link for a scope (null: every row), an origin and an import, each parameter once. */
export function ledgerHref({ scopeId, from, importId }: { scopeId: string | null; from: LedgerOrigin | null; importId: number | null }) {
  const params = new URLSearchParams();
  if (scopeId) params.set("scope", scopeId);
  if (from) params.set("from", from);
  const query = params.toString();
  return withImport(query ? `/ledger?${query}` : "/ledger", importId);
}

/** The back link to `origin`, on the same import. */
export function originHref(origin: LedgerOrigin, importId: number | null) {
  return withImport(LEDGER_ORIGINS[origin].href, importId);
}
