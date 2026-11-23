# Roadmap

What comes after v1, and on what evidence. Nothing here is promised: each item says what would
make it worth doing and how that would be measured. Items move into a checkpoint only with the
owner's decision.

## v1.1

| Item | Why | What it needs first |
|---|---|---|
| **Plain-Python analysis, dropping pandas** | pandas is the largest part of the download: a first visit is about 14.7 MB gzip with it and 7.4 MB without (`tools/measure_bundle.py`). The analysis uses pandas for grouping and dates only (ADR 0006, `docs/decisions/analysis-behaviour.md`) | The report must stay identical: every analysis test, the equivalence gates and the scenario reports. Measure the load and run time it saves on a phone |
| **UNCLASSIFIED pattern analysis** | Rows no rule recognises are counted (`unclassified_rows`, `unrecognized_event_type` observations) but not grouped, so a recurring new transaction type is not visible as one | Counts of unclassified rows and their details' shapes from the owner's real runs, never their text |
| **Per-type summary-row reconciliation** | The statement summary's seven type rows are parsed but only TOTAL is checked (`reconciliation/summary.py`). Checking each type would say which kind of transaction disagrees | A mapping from the summary's type labels to event types that the owner confirms against a real statement |
| **A-1 to A-3** | Money compared at cents, each row's date parsed in its own format, rows with a bad date kept and counted (`behaviour-changes.md`) | Data: each changes figures, so each waits for a real case where the old behaviour is wrong |
| **Other statement formats** | Only the M-PESA personal statement layout is read; anything else is `LAYOUT_UNRECOGNIZED`. Business or older layouts would need their own calibration | A real example of the layout (seen by the owner only) and a synthetic generator variant that reproduces it |
| **Phone verification** | Every limit and timing was measured on desktop Chrome; the copy says other browsers are untested (CP10a). iOS Safari's storage eviction and worker memory limit are open (OQ-16) | Measurements on real phones: the largest statement read, timings per stage, memory, and whether saved data survives |

## The Rust question

Should part of the core move to Rust compiled to WebAssembly? **Only on measured need.** Today
nothing says it should: the core runs in Pyodide within the desktop limits (`pdf_reader/limits.js`,
`docs/decisions/cp8-notes.md`), and its tests run under CPython and Pyodide alike.

It becomes a question when a measurement shows all of:

1. A stage that takes too long, or too much memory, on a phone the app should support, measured per
   stage (`tools/measure_stage_timing.mjs`) on a realistic synthetic statement.
2. That stage is the core's own Python, not pdf.js, pandas loading or the download.
3. A plain-Python fix (the v1.1 analysis rewrite, an algorithm change) does not bring it within limits.

Even then the cost is real: a second language for a pure core, a second build, and the equivalence
gates and the CPython/Pyodide test runs would need a third implementation to agree. Until such a
measurement exists, the answer is no.
