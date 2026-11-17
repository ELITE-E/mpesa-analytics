// formatDateTime (IA migration Stage 4b, DR-1 display): a transaction's
// `completion_time` shown as the statement states it, "4 Jul 2026, 10:00"
// (lib/format.ts date style plus the prototype's 24-hour "HH:MM"), never
// shifted to another timezone. An invalid value is shown as its raw text;
// an absent one as "—", like formatDate.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/format-date-time.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { formatDateTime } = await import("../src/lib/format.ts");

describe("formatDateTime", () => {
  test("shows both supported formats identically, in statement-local time", () => {
    assert.equal(formatDateTime("2026-07-04 10:00:00"), "4 Jul 2026, 10:00");
    assert.equal(formatDateTime("2026-07-04T10:00:00"), "4 Jul 2026, 10:00");
  });

  test("never shifts across a day boundary (no timezone conversion)", () => {
    assert.equal(formatDateTime("2026-12-31 23:59:59"), "31 Dec 2026, 23:59");
    assert.equal(formatDateTime("2026-01-01 00:00:00"), "1 Jan 2026, 00:00");
  });

  test("shows an invalid value as its raw text", () => {
    for (const raw of ["04/07/2026 12:00", "2026-13-45 99:99:99", "not a timestamp"]) {
      assert.equal(formatDateTime(raw), raw);
    }
  });

  test("shows an absent value as a dash", () => {
    for (const absent of [null, undefined, ""]) assert.equal(formatDateTime(absent), "—");
  });
});
