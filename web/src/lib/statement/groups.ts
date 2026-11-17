// Groupings (DR-8, plan rev1 §1.2): merchants, people, agents… are the rows of
// one bucket grouped by entity, exactly as the backend groups them.

import type { BucketId, StatementRow } from "@/lib/statement/rows";

/** The entity the backend stores when none was found (src/entity.py). */
export const NO_ENTITY = "NO_ENTITY_IDENTIFIED";

/** One entity's principal within a bucket, and the rows it was made from. */
export type EntityGroup = { entity: string; label: string; cents: number; rowIds: number[] };

/**
 * DR-8: the rows of `bucket` grouped by their exact stored `entity`, in order
 * of first appearance. Rows without an identified entity form one group
 * labelled "Not identified". Grouping by name can merge or split real outlets
 * the same way the backend's analytics do; buckets are never mixed.
 */
export function groupsInBucket(rows: StatementRow[], bucket: BucketId): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();
  for (const row of rows) {
    if (row.bucket !== bucket) continue;
    const group = groups.get(row.entity) ?? {
      entity: row.entity,
      label: row.entity === NO_ENTITY ? "Not identified" : row.entity,
      cents: 0,
      rowIds: [],
    };
    group.cents += row.principalCents;
    group.rowIds.push(row.id);
    groups.set(row.entity, group);
  }
  return [...groups.values()];
}
