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
| 0006 | Runtime dependencies of `mpesa_core` | Accepted (CP7a-2): pandas in `analysis/` only, lazy, optional extra; plain-Python rewrite is v1.1 |
| 0007 | Replace PagesDocument with StatementPages | Proposed |
| 0008 | Layout profile of the synthetic golden statement | Accepted (CP1) |
| 0009 | Column calibration and row assembly | Accepted (CP3); OQ-03 and OQ-10 await the real counts |
| 0010 | Restructure for readability | Proposed |
| 0011 | Timing of the pandas-free core | Measured (CP5) |
| 0012 | v1 scope: "Remember on this device" stays, opt-in, with saving and merging | Accepted (CP7a), owner instruction |
| 0013 | The architecture CSP holds for the browser engine (OQ-08) | Accepted (CP8a), measured in Chrome |
| 0014 | Lint the web app with its own ESLint 9; the rest of the repo keeps ESLint 10 | Accepted (CP8b), owner decision |
| 0015 | The web app is a static export, served with the architecture CSP plus per-page script hashes | Accepted (CP8b), owner instruction, measured in Chrome |
| 0018 | A hand-written service worker that caches only the build's allow-list; offline after a first load; updates wait for the person | Accepted (CP10a), owner instruction |
| 0017 | One encrypted ledger per account, merged by the core's plan, saved in one write; merged period (union) and closing balance across statements | Accepted (CP9b), owner instruction |
| 0016 | "Remember on this device" is an encrypted vault: WebCrypto, whole-ledger blobs, off by default (supersedes the migration plan's D4 plaintext recommendation) | Accepted (CP9a), owner instruction; what the lock does and does not protect: `docs/THREAT_MODEL.md` |

## Logs

| File | What it records |
|---|---|
| `behaviour-changes.md` | Every deliberate difference from the old behaviour |
| `test-edits.md` | Every edit to an existing test, and guard changes made during review |
| `cp8-notes.md` | Caveats to act on at CP8 |
| `cp10-list.md` | Work agreed for CP10, with the tests it must bring |
| `equivalence-results.md` | Counts from the owner's runs on real statements, and the open questions they answer |
| `cleaning-behaviour.md` | The old cleaning step's rules, which `cleaning/` ports |
| `classification-behaviour.md` | The old classifier's and entity step's rules, which `classification/` ports |
| `analysis-behaviour.md` | The old analytics' rules and report keys, which `analysis/` ports |
| `identity-behaviour.md` | The old identity rules (candidate key, material fingerprint, NEW, MATCH, COLLISION) and what the old atomic import stored |
| `import-plan-behaviour.md` | What `plan_statement_import` decides for the browser store, and how a plan is checked |

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
