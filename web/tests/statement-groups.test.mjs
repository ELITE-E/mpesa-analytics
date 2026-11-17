// Statement domain, groupings (IA migration Stage 4b; plan rev1 DR-8):
// within one bucket, rows grouped by their exact stored `entity` (as the
// backend's groupby("entity") does, src/analytics/spending.py), with
// NO_ENTITY_IDENTIFIED (src/entity.py) shown as "Not identified"; a group's
// figure is principal, and it keeps the ids of the rows it was made from.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/statement-groups.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contractFixtures } from "./support/contract-fixtures.mjs";

const { toStatementRow } = await import("../src/lib/statement/rows.ts");
const { outflowAllocation } = await import("../src/lib/statement/totals.ts");
const { groupsInBucket } = await import("../src/lib/statement/groups.ts");

const FIXTURES = contractFixtures();
const f1Rows = FIXTURES["F1-worked-example"].rows.map(toStatementRow);
const f5Rows = FIXTURES["F5-prototype-converted"].rows.map(toStatementRow);

describe("DR-8 groupings", () => {
  test("groups a bucket's rows by entity, in order of first appearance (F1 sent to people)", () => {
    assert.deepEqual(groupsInBucket(f1Rows, "sent-to-people"), [
      { entity: "Person", label: "Person", cents: 150000, rowIds: [9] },
      { entity: "Second Person", label: "Second Person", cents: 30000, rowIds: [18] },
    ]);
  });

  test("gathers rows without an identified entity as 'Not identified' (F1 not classified out)", () => {
    assert.deepEqual(groupsInBucket(f1Rows, "not-classified-out"), [
      { entity: "NO_ENTITY_IDENTIFIED", label: "Not identified", cents: 45000, rowIds: [15, 19] },
    ]);
  });

  test("a bucket's groups add up to the bucket, each row in exactly one group (F5 spending)", () => {
    const groups = groupsInBucket(f5Rows, "spending");
    const bucket = outflowAllocation(f5Rows).find((total) => total.bucket === "spending");
    assert.ok(groups.length > 1);
    assert.equal(groups.reduce((total, group) => total + group.cents, 0), bucket.cents);
    assert.deepEqual(groups.flatMap((group) => group.rowIds).sort((a, b) => a - b), [...bucket.rowIds].sort((a, b) => a - b));
  });

  test("never merges buckets: a person who sent and received appears in each, separately (F5)", () => {
    const sent = groupsInBucket(f5Rows, "sent-to-people").find((group) => group.entity === "Mary Wanjiku");
    const received = groupsInBucket(f5Rows, "from-people").find((group) => group.entity === "Mary Wanjiku");
    assert.ok(sent && received);
    const rowOf = (id) => f5Rows.find((row) => row.id === id);
    assert.ok(sent.rowIds.every((id) => rowOf(id).direction === "out"));
    assert.ok(received.rowIds.every((id) => rowOf(id).direction === "in"));
  });

  test("keeps entities that differ only in case apart, like the backend", () => {
    const rows = structuredClone(FIXTURES["F1-worked-example"].rows);
    rows.find((row) => row.id === 18).entity = "PERSON";
    const groups = groupsInBucket(rows.map(toStatementRow), "sent-to-people");
    assert.deepEqual(groups.map((group) => group.entity), ["Person", "PERSON"]);
  });

  test("a bucket without rows has no groups", () => {
    assert.deepEqual(groupsInBucket(f1Rows, "loan-repayments"), []);
    assert.deepEqual(groupsInBucket([], "spending"), []);
  });
});
