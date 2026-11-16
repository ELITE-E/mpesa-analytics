# 0008. Layout profile of the synthetic golden statement

Status: Accepted
Date: 2026-11-02

## Context

Realism comes from the synthetic generator, which is checked against a real statement by aggregate layout profiles only (standards 9.5). `tools/equivalence/layout_profile.py` produces that profile. This record holds the synthetic side of the comparison. The real side runs only on the owner's machine (standard 12.5) and is not recorded here until the owner chooses to add it.

## Decision

The profiler takes a PDF path and prints fixed labels and numbers, never text from the PDF and never its path. It stops with an error type only if the PDF cannot be read. If the PDF needs a password, it asks with a hidden prompt on a terminal, or reads one line from piped stdin. It never accepts a password from the command line or the environment.

Output for `fixtures/synthetic/F-GOLDEN.pdf`, from generator 1.6.0 (CP7a-3: the real summary block and an invented name, phone and email on page 1):

```
page_count: 2
page_size: 595 x 848
line_pitch_median: 10
line_pitch_spread: 4
header_to_data_x0_offset_by_column: -10.41, -9.66, -37.65, 1, 10.58, 23.44, 14.08
header_to_data_x0_offset_max: 37.65
column_x0_clusters: [71.49, 131.5, 207.5, 310.49, 449.67, 452.7, 501.1]
column_x1_clusters: [106.01, 182.56, 292.24, 337.08, 466.47, 522.51]
receipt_length_histogram: {10: 60}
anchor_row_count: 60
multi_line_row_share: 0.42
```

Run it with:

    uv run python tools/equivalence/layout_profile.py <path>

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Compare real and synthetic PDFs directly in a test | Needs real statements in the repo, which is forbidden |
| Print sample rows to help tuning | One forgotten flag leaks a statement |
| Fixed labels and numbers only (chosen) | Debugging a mismatch takes longer, because only numbers are available |

## Consequences

- Measurements come from pdfplumber, not pdf.js. pdfplumber's `top` sits 0.207 x font size lower than pdf.js's, which is how `items.json` and `model.json` report it.
- The profiler assumes the seven header labels start with the words in `HEADER_FIRST_WORDS`, dates are printed as `YYYY-MM-DD`, and receipts are 8 to 14 uppercase characters with a digit. **None of this has been checked against a real statement.** If a real statement differs, `anchor_row_count` or the header offsets will read 0 or look wrong, and those assumptions need updating. Nothing is leaked in that case.
- Column clusters ignore positions used by under 5% of edges, so amount columns show right edges only.

## Enforcement

`tests/synth/test_layout_profile.py` plants a marker in a PDF's table, summary and file name and checks it never appears; checks every output line is labels and numbers; and checks this record still matches the tool's output. It also opens F-ENCRYPTED through piped stdin and through a real pseudo-terminal, checks the password never appears in the output, and checks password options and environment variables are refused or ignored.
