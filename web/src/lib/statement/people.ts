// The People area's figures (IA migration Stage 7b): money exchanged with
// other people, both directions, from the API's transfer totals (M-15) and
// the Stage 4b statement model, each with the Ledger scope its door opens
// (DR-10, I-4). Identity is the exact stored `entity` (DR-8; the API has no
// phone number, M-16). Decisions: Q-LINK (charges display only), Q-D9
// (T-LOADFAIL, T-UNVERIFIED). Amounts are integer cents.

import type { AnalyticsResult, ImportSummary } from "@/lib/api";
import { linkCharges, linkedChargesByParent, summarizeCharges } from "@/lib/statement/charges";
import { groupsInBucket, NO_ENTITY, type EntityGroup } from "@/lib/statement/groups";
import { toCents, type StatementRow } from "@/lib/statement/rows";

/** One direction of money with people: its principal, row count, how many identified people, and its bucket scope. */
export type DirectionFigure = { cents: number; count: number; people: number; scopeId: string };

/** One person's money in one direction, and the scope of exactly those rows. */
export type PersonDirection = { cents: number; count: number; scopeId: string };

/** One person (one exact stored entity): what was sent to them and received from them; null for a direction without rows. */
export type PersonFigure = { entity: string; label: string; sent: PersonDirection | null; received: PersonDirection | null };

/** One of the largest sends, with the charge linked to it (display only), opening its receipt. */
export type SendFigure = { receiptNo: string; entity: string; label: string; cents: number; chargeCents: number; time: string; scopeId: string };

/** The derived People figures, or withheld when the rows disagree with the API's transfer totals (T-UNVERIFIED). */
export type PeopleBreakdown =
  | {
      status: "shown";
      sent: DirectionFigure;
      received: DirectionFigure;
      /** Received minus sent. */
      netCents: number;
      /** Everyone money moved with, by total moved, largest first (ties keep statement order). */
      people: PersonFigure[];
      largestSends: SendFigure[];
      /** Charges linked to sends (Q-LINK, display only; counted in Fees): their sum and how many sends carried one. */
      sendCharges: { cents: number; count: number };
      /** Charges on the statement not linked to one transaction (rev2 R1.2 disclosure). */
      unlinkedChargeCount: number;
    }
  | { status: "unverified" };

export type PeopleFigures = {
  /** The API's transfer totals (M-15): always available. */
  api: { sentCents: number; receivedCents: number };
  /** null without rows (T-LOADFAIL). */
  breakdown: PeopleBreakdown | null;
};

/** Sends listed as the largest (IA prototype). */
const LARGEST_SHOWN = 3;

/** A direction's total, row count and identified people, from its DR-8 groups. */
function direction(groups: EntityGroup[], scopeId: string): DirectionFigure {
  return {
    cents: groups.reduce((total, group) => total + group.cents, 0),
    count: groups.reduce((total, group) => total + group.rowIds.length, 0),
    people: groups.filter((group) => group.entity !== NO_ENTITY).length,
    scopeId,
  };
}

/** Everyone in either direction, merged by exact entity, largest total moved first (a stable sort, so ties keep first appearance). */
function peopleOf(sent: EntityGroup[], received: EntityGroup[]): PersonFigure[] {
  const people = new Map<string, PersonFigure>();
  const personOf = (group: EntityGroup) => people.get(group.entity) ?? { entity: group.entity, label: group.label, sent: null, received: null };
  for (const group of sent) {
    people.set(group.entity, { ...personOf(group), sent: { cents: group.cents, count: group.rowIds.length, scopeId: `group:sent-to-people:${group.entity}` } });
  }
  for (const group of received) {
    people.set(group.entity, { ...personOf(group), received: { cents: group.cents, count: group.rowIds.length, scopeId: `group:from-people:${group.entity}` } });
  }
  const moved = (person: PersonFigure) => (person.sent?.cents ?? 0) + (person.received?.cents ?? 0);
  return [...people.values()].sort((a, b) => moved(b) - moved(a));
}

/** The LARGEST_SHOWN largest sends by principal (ties keep statement order), each with its linked charge. */
function largestSends(sends: StatementRow[], chargesByParent: Map<number, number>, labels: Map<string, string>): SendFigure[] {
  return [...sends]
    .sort((a, b) => b.principalCents - a.principalCents)
    .slice(0, LARGEST_SHOWN)
    .map((row) => ({
      receiptNo: row.receiptNo,
      entity: row.entity,
      label: labels.get(row.entity) ?? row.entity,
      cents: row.principalCents,
      chargeCents: chargesByParent.get(row.id) ?? 0,
      time: row.source.completion_time,
      scopeId: `receipt:${row.receiptNo}`,
    }));
}

/**
 * Every figure the People area shows for one import. The API's sent and
 * received totals stand on their own; without rows (still loading, or
 * failed: T-LOADFAIL) nothing else is shown. With rows, every derived figure
 * is withheld unless the Sent-to-people and From-people buckets equal the
 * API's totals exactly (M-15 "API = Σ rows"; T-UNVERIFIED).
 */
export function peopleFigures({ analytics, rows }: { summary: ImportSummary; analytics: AnalyticsResult; rows: StatementRow[] | null }): PeopleFigures {
  const { transfers } = analytics;
  const api = { sentCents: toCents(transfers.total_transfers.total_transfer_amount), receivedCents: toCents(transfers.total_received.total_received) };
  if (rows === null) return { api, breakdown: null };

  const sentGroups = groupsInBucket(rows, "sent-to-people");
  const receivedGroups = groupsInBucket(rows, "from-people");
  const sent = direction(sentGroups, "bucket:sent-to-people");
  const received = direction(receivedGroups, "bucket:from-people");
  if (sent.cents !== api.sentCents || received.cents !== api.receivedCents) return { api, breakdown: { status: "unverified" } };

  const sends = rows.filter((row) => row.bucket === "sent-to-people");
  const links = linkCharges(rows);
  const chargesByParent = linkedChargesByParent(rows, links);
  const labels = new Map(sentGroups.map((group) => [group.entity, group.label]));
  const charged = sends.filter((row) => (chargesByParent.get(row.id) ?? 0) > 0);
  return {
    api,
    breakdown: {
      status: "shown",
      sent,
      received,
      netCents: received.cents - sent.cents,
      people: peopleOf(sentGroups, receivedGroups),
      largestSends: largestSends(sends, chargesByParent, labels),
      sendCharges: { cents: charged.reduce((total, row) => total + (chargesByParent.get(row.id) ?? 0), 0), count: charged.length },
      unlinkedChargeCount: summarizeCharges(rows, links).unlinkedCount,
    },
  };
}
