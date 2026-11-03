# Decisions

Architecture decision records (ADRs) and logs. An ADR records one decision, why, and what it costs. Logs record repeated small facts.

## ADR index

| # | Title | Status |
|---|---|---|
| 0001 | Pinned runtime versions | Accepted (CP0) |
| 0002 | Pandas load probe | Accepted (CP0), numbers recorded |
| 0003 | Fake phone ranges for fixtures | Proposed, allocation not confirmed |
| 0004 | Error messages carry no statement values | Proposed |
| 0005 | Module moves from mpesa-parser | Proposed |
| 0006 | Runtime dependencies of `mpesa_core` | Open: decided at the CP5 gate |
| 0007 | Replace PagesDocument with StatementPages | Proposed |
| 0008 | Layout profile of the synthetic golden statement | Accepted (CP1) |

## Logs

| File | What it records |
|---|---|
| `behaviour-changes.md` | Every deliberate difference from the old behaviour |
| `test-edits.md` | Every edit to an existing test, and guard changes made during review |

## ADR template

Copy this for a new ADR. Number sequentially; never reuse a number.

```
# NNNN. Title

Status: Proposed | Accepted | Superseded by NNNN
Date: YYYY-MM-DD

## Context
What forces the decision. Facts and measurements, not opinions.

## Decision
What we do, in plain words.

## Alternatives considered
| Option | Tradeoff |
|---|---|

## Consequences
What gets easier, what gets harder, what must be tested.

## Enforcement
Which test, guard or review item keeps this true.
```
