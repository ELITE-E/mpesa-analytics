# 0012. v1 scope: "Remember on this device" stays, opt-in, with saving and merging

Status: Accepted (owner instruction, CP7a)
Date: 2026-11-13

## Context

The old mpesa-parser stored every statement in a server database and matched transactions across statements by identity (`src/persistence/identity.py`, `collisions.py`). The rewrite has no server (ADR 0005, standards 5.8 and 12). Dropping storage entirely would make v1 smaller but would lose the old feature of building a history from several statements. Keeping it means browser storage and identity matching must be as careful as the old database was.

## Decision

The full "Remember on this device" feature is in v1:

- **Opt-in.** By default nothing is stored. The user turns it on.
- **Saving and merging.** A remembered statement's transactions are saved, and a later statement is merged with them: repeated transactions are recognised, collisions are kept side by side, never overwritten.
- **Where the work lands.**
  - CP7a (this checkpoint): `pipeline.run` returns a `PipelineResult` of plain JSON values only, with nothing in it that must never be stored: no PDF bytes and no password, which never reach the core. Tests check both.
  - CP7b: identity matching is ported into the core (`reconciliation/identity.py`), pure and without storage; the 13 identity behaviours in the CP7b list.
  - CP9: the browser store (`web/src/persistence`) and the merge screens; the 4 collision behaviours are rewritten there; a failed save leaves no partial records and "delete all" removes everything (standards 5.8).

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Drop storage from v1 | Smaller v1, but no history across statements, which the old system had |
| Save without merging | Simpler, but repeated transactions would be counted twice across statements |
| Opt-in saving and merging (chosen) | Most work: identity in the core, a careful browser store, merge screens |

## Consequences

- `PipelineResult` must stay JSON-serializable and free of secrets; any new field is checked by `test_result_is_json_serializable_with_plain_values_only` and `test_result_holds_no_bytes_or_password_even_if_the_pages_carry_them`.
- CP7b must keep identity pure: no storage, no clock (any time is passed in).
- CP9 carries the integrity tests of standards 5.8.

## Enforcement

- `tests/core/test_pipeline.py` and `tests/synth/test_pipeline_fixtures.py` (JSON values only, no bytes, no password).
- `tests/core/test_contracts.py::test_pipeline_result_has_no_field_for_pdf_bytes_or_a_password`.
- CP7b and CP9 test lists, when written.
