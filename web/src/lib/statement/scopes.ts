// Ledger scopes (DR-10, plan rev1 §1.2): the rows a figure stands for and how
// they are measured, so that every figure equals what its Ledger scope shows
// (I-4). The IDs that name scopes in Ledger URLs come with Stage 5 (Q-R2).

import { INFLOW_BUCKETS, isInflowBucket, OUTFLOW_BUCKETS, toCents, type BucketId, type StatementRow } from "@/lib/statement/rows";
import { chargeCauses } from "@/lib/statement/charges";
import type { EntityGroup } from "@/lib/statement/groups";

/**
 * How a scope's rows add up to its figure: money in (Σ `paid_in`), money out
 * (Σ `paid_out` of non-fee rows), charges (Σ `paid_out` of `FEE` rows), both
 * of the last two, or "both" directions, which has no single figure.
 */
export type ScopeMeasure = "in" | "out" | "charges" | "out+charges" | "both";

/** A set of rows, `FEE` rows members in their own right, and its measure. */
export type Scope = { rowIds: number[]; measure: ScopeMeasure };

/** The measure of a bucket's figure: Charges by charges, sources by in, other outflow buckets by out. */
function measureOfBucket(bucket: BucketId): ScopeMeasure {
  if (bucket === "charges") return "charges";
  return isInflowBucket(bucket) ? "in" : "out";
}

/** DR-10: the scope of an allocation bucket or inflow source (DR-5, DR-6). */
export function bucketScope(rows: StatementRow[], bucket: BucketId): Scope {
  return { rowIds: rows.filter((row) => row.bucket === bucket).map((row) => row.id), measure: measureOfBucket(bucket) };
}

/** DR-10: the scope of an entity group (DR-8) of `bucket`, measured like the bucket. */
export function groupScope(group: EntityGroup, bucket: BucketId): Scope {
  return { rowIds: group.rowIds, measure: measureOfBucket(bucket) };
}

/**
 * DR-10: the figure of `scope` over `rows`, in cents; null for a scope
 * measured "both", which has no single figure. An empty scope measures zero.
 */
export function scopeFigureCents(rows: StatementRow[], scope: Scope): number | null {
  if (scope.measure === "both") return null;
  const members = new Set(scope.rowIds);
  let inCents = 0;
  let outCents = 0;
  let chargeCents = 0;
  for (const row of rows) {
    if (!members.has(row.id)) continue;
    inCents += toCents(row.source.paid_in);
    if (row.isCharge) chargeCents += toCents(row.source.paid_out);
    else outCents += toCents(row.source.paid_out);
  }
  if (scope.measure === "in") return inCents;
  if (scope.measure === "out") return outCents;
  if (scope.measure === "charges") return chargeCents;
  return outCents + chargeCents;
}

/**
 * DR-10: the measure a set of rows calls for: "in" when all move money in,
 * "out" or "charges" when all move it out (non-fee or `FEE` rows), "out+charges"
 * when both of those, and "both" when rows go both ways (or there are none to
 * say), which has no single figure.
 */
export function measureOfRows(rows: StatementRow[]): ScopeMeasure {
  const hasIn = rows.some((row) => row.direction === "in");
  const hasOut = rows.some((row) => row.direction === "out" && !row.isCharge);
  const hasCharge = rows.some((row) => row.direction === "out" && row.isCharge);
  if (hasIn && (hasOut || hasCharge)) return "both";
  if (hasIn) return "in";
  if (hasOut && hasCharge) return "out+charges";
  if (hasCharge) return "charges";
  return hasOut ? "out" : "both";
}

/**
 * The Ledger's named scopes (decision Q-R2; money in and out added for
 * Overview's doors in Stage 6): which rows each holds and how it is measured.
 * Money in and out are every row of that direction, as the API's
 * `total_inflow` and `total_outflow` count them (charges included in out).
 */
const NAMED_LEDGER_SCOPES: Record<string, { matches: (row: StatementRow) => boolean; measure?: ScopeMeasure }> = {
  unclassified: { matches: (row) => row.eventType === "UNCLASSIFIED" },
  fees: { matches: (row) => row.isCharge, measure: "charges" },
  investments: { matches: (row) => row.eventType === "INVESTMENT", measure: "out" },
  "money-in": { matches: (row) => row.direction === "in", measure: "in" },
  "money-out": { matches: (row) => row.direction === "out", measure: "out+charges" },
};

/** The DR-3 buckets a "bucket:" scope can name. */
const BUCKET_IDS: string[] = [...OUTFLOW_BUCKETS, ...INFLOW_BUCKETS];

/**
 * The channels of the Spending bucket by event type (plan M-11, DR-3's
 * channel column): Buy Goods tills, Paybill and data bundles. Stage 7a.
 */
export const SPENDING_CHANNELS = { till: "MERCHANT_PAYMENT", paybill: "BILL_PAYMENT", bundle: "BUNDLE_PURCHASE" } as const;

export type SpendingChannel = keyof typeof SPENDING_CHANNELS;

/** A Ledger scope: its URL id (Q-R2), its rows in statement order, and its measure. */
export type LedgerScope = Scope & { id: string; kind: "named" | "bucket" | "channel" | "group" | "cause" | "entity" | "receipt"; value: string };

/**
 * How a Ledger scope id picks its rows: `matches` tests one row, or, for a
 * scope that depends on other rows (a charge's cause), `prepare` builds that
 * test from all of them.
 */
type ScopeMatcher = {
  kind: LedgerScope["kind"];
  value: string;
  matches: (row: StatementRow) => boolean;
  prepare?: (rows: StatementRow[]) => (row: StatementRow) => boolean;
  measure?: ScopeMeasure;
};

/** Which rows a Ledger scope id names, or null when the id is outside the Q-R2 vocabulary. */
function ledgerScopeMatcher(id: string): ScopeMatcher | null {
  const named = NAMED_LEDGER_SCOPES[id];
  if (named) return { kind: "named", value: id, ...named };
  const separator = id.indexOf(":");
  const prefix = id.slice(0, separator);
  const value = id.slice(separator + 1);
  if (separator < 1 || !value) return null;
  if (prefix === "entity") return { kind: "entity", value, matches: (row) => row.entity === value };
  if (prefix === "receipt") return { kind: "receipt", value, matches: (row) => row.receiptNo === value };
  if (prefix === "bucket" && BUCKET_IDS.includes(value)) {
    return { kind: "bucket", value, matches: (row) => row.bucket === value, measure: measureOfBucket(value as BucketId) };
  }
  if (prefix === "spending" && value in SPENDING_CHANNELS) {
    const eventType = SPENDING_CHANNELS[value as SpendingChannel];
    return { kind: "channel", value, matches: (row) => row.bucket === "spending" && row.eventType === eventType, measure: "out" };
  }
  if (prefix === "group") return groupMatcher(value);
  if (prefix === "fees") return causeMatcher(value);
  return null;
}

/**
 * A "fees:<event type>" scope (Stage 7c, decision Q-D7): the `FEE` rows
 * linked (DR-2) to a transaction of that event type, or "fees:unlinked" for
 * the orphan and ambiguous ones, measured as charges. The causes partition
 * the "fees" scope.
 */
function causeMatcher(value: string): ScopeMatcher {
  return {
    kind: "cause",
    value,
    matches: () => false,
    prepare: (rows) => {
      const causes = chargeCauses(rows);
      return (row) => causes.get(row.id) === value;
    },
    measure: "charges",
  };
}

/**
 * A "group:<bucket>:<entity>" scope (DR-8 within one bucket, as groupScope):
 * the bucket's rows with that exact stored entity, measured like the bucket.
 * `value` is "<bucket>:<entity>"; null when the bucket is unknown or the
 * entity is empty.
 */
function groupMatcher(value: string) {
  const separator = value.indexOf(":");
  const bucket = value.slice(0, separator);
  const entity = value.slice(separator + 1);
  if (separator < 1 || !entity || !BUCKET_IDS.includes(bucket)) return null;
  return {
    kind: "group" as const,
    value,
    matches: (row: StatementRow) => row.bucket === bucket && row.entity === entity,
    measure: measureOfBucket(bucket as BucketId),
  };
}

/** Whether `id` is spelled as a Ledger scope of the Q-R2 vocabulary (it may still match no rows). */
export function isLedgerScopeId(id: string) {
  return ledgerScopeMatcher(id) !== null;
}

/**
 * The Ledger scope `id` names (decision Q-R2): "unclassified", "fees"
 * (the `FEE` rows), "investments", "money-in", "money-out",
 * "bucket:<DR-3 bucket>" (an allocation bucket or source, DR-5/DR-6),
 * "spending:<till|paybill|bundle>" (a Spending channel), "group:<DR-3
 * bucket>:<exact stored entity>" (one entity within a bucket, DR-8),
 * "fees:<event type>|unlinked" (charges by cause, Stage 7c),
 * "entity:<exact stored entity>" or "receipt:<receipt_no>". Its rows keep statement order; a named scope has a
 * fixed measure where one is defined, otherwise the measure its rows call for
 * (measureOfRows). An entity or receipt with no rows is an empty scope. Any
 * other id (identifiers, statement lines, paybills, …) is null.
 */
export function resolveLedgerScope(id: string, rows: StatementRow[]): LedgerScope | null {
  const matcher = ledgerScopeMatcher(id);
  if (!matcher) return null;
  const members = rows.filter(matcher.prepare ? matcher.prepare(rows) : matcher.matches);
  return {
    id,
    kind: matcher.kind,
    value: matcher.value,
    rowIds: members.map((row) => row.id),
    measure: matcher.measure ?? measureOfRows(members),
  };
}
