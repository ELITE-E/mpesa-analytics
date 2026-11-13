# 0006. Runtime dependencies of `mpesa_core`

Status: Accepted for v1 (CP6, 2026-11-12). The plain-Python rewrite of analysis is a v1.1 task.
Date: 2026-11-02

## Context

The app ships to the user's browser, so every runtime dependency costs download and start-up time (standard 10.1).

Measured at CP0 (see 0001 and 0002):

| Group | Raw bytes | Gzip bytes |
|---|---:|---:|
| Pyodide core | 13,531,207 | 6,325,376 |
| numpy | 2,960,568 | 2,924,334 |
| pandas (with dateutil, pytz, six) | 4,929,180 | 4,758,195 |
| pdf.js | 1,723,246 | 505,611 |

With pandas, the first-load download is about 14.5 MB gzip. Without pandas and numpy it is about 6.8 MB. On a 2015 i5 laptop, a repeat pandas start took 22.5 s unthrottled (limit 20 s).

The pandas audit found: 68 functions touch pandas; no hard cases; 23 semantic differences; a full rewrite is 26 to 47 hours. The ledger path (`utils`, `clean`, `engine`, `cash_flow`, `fees`, `result`, extraction boundary) is about 8 to 12 hours. The analytics modules (`preparation`, `spending`, `orchestration`) are about 9 to 14 hours plus test rewrites.

## Decision (staged)

1. **Now:** the ledger path is written without pandas, on row records.
2. **At the CP5 gate:** decide the analytics modules.
   - Keep pandas for analytics, loaded lazily, **or**
   - rewrite analytics in plain Python.
3. The gate decision uses: the measured start-up of the pandas-free core, any phone numbers a friend sends from the static probe page, and the audit's rule (full rewrite if the remaining cost fits the schedule).

## Decision at the CP5 gate (owner, 2026-11-12)

**The ledger path stays pandas-free:** extraction, cleaning, classification and reconciliation. **pandas is allowed only inside `mpesa_core.analysis`, imported lazily, for v1.** Rewriting analysis in plain Python is a v1.1 task.

Reasons:
- **Schedule.** The audit put the full rewrite at 26 to 47 hours, and the analytics modules alone at 9 to 14 hours plus test rewrites. Porting them on pandas keeps v1's dates.
- **The cost is contained.** The pandas-free core loads in about 10 seconds under Pyodide, against 34 to 43 seconds with pandas, on the same machine (ADR 0011). Loading pandas only when analysis runs keeps that cost off everything else.
- **The D-01 risk is designed out.** Rows enter pandas at one boundary as plain strings, never enum members.

How it is held in place:
- **Import-linter:** a contract forbids pandas in every core package except `analysis`.
- **A test:** importing every other core module in a fresh interpreter leaves pandas out of `sys.modules`.
- **The wheel:** it still declares no runtime dependency. pandas is the optional extra `analysis`, pinned to the Pyodide runtime's version, 3.0.2.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Keep pandas everywhere | Least work; slow start and a 14.5 MB first load; phones unmeasured |
| Rewrite everything now | Smallest and fastest; +26 to 47 hours before the gate, less slack |
| Staged (chosen) | Builds what both paths need first, then decides on measured numbers |

## Consequences

- The overview screen uses `largest_purchases`, so lazy pandas still loads on the landing screen unless spending is ported.
- If pandas stays, any frame built from rows must receive plain strings, not enum members, or the D-01 bug returns.
- Any new runtime dependency needs its own ADR and a size check against the budget (15 MB gzip over the wire; 8 MB without pandas).

## Enforcement

The wheel check fails if `mpesa_core` declares an undeclared runtime dependency. `measure_bundle.py` fails CI when the budget is exceeded.
