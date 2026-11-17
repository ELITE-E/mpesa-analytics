# Test edits log

Rule (standards 9.7): a failing test is evidence. Any edit to an existing test after it was written is recorded here with the old assertion, the new assertion and the reason. Adding a new test is not an edit.

| # | Date | Test | Old assertion | New assertion | Reason | Approved |
|---|---|---|---|---|---|---|
| 1 | CP0 | `test_wiring.py`, the "no secrets" check | `secrets.` (a plain substring check, not a regex) | `\bsecrets\.` | The old pattern also matched the `check_secrets.py` file name that another assertion requires in `ci.yml`, so the two assertions could never both pass. The narrowed pattern still matches a real `secrets.` reference | Owner, at CP0 review |
| 2 | 2026-11-02 | CP0 tests, renames for rule 1.2 | `result`, `data` as variables | `guard_run`, `fixture_bytes` | Tests are exempt from the docstring rule only, so banned names apply. Mechanical; see "Renames in CP0 tests" below | Pending owner review |
| 3 | 2026-11-02 | `test_python_lint.py`, E711 plant | Snippet `RATE = 1 == None` | Snippet `RATE = rows == None` | The test was wrong: ruff does not report E711 with a literal on the left, so the plant never fired. This edit was made to get a failing test to pass. The assertion is unchanged | Pending owner review |
| 4 | 2026-11-02 | `test_python_lint.py`, planted rules | Planted at `tools/planted.py` | Planted at `src/planted.py` | `tools/**` now ignores T201 by owner decision, so the T201 plant must sit elsewhere. The assertion is unchanged, and a new test covers tools | Owner instruction |
| 5 | 2026-11-02 | `test_standards_docs.py`, template match | `findall(template) == review_checklist()` | Every standards item is in the template, allowing 2 declared rewordings | The pack's template is authoritative: it drops final periods, rewords 2 items and moves the privacy group | Owner instruction |
| 6 | 2026-11-02 | `test_standards_docs.py`, template groups | `len(groups) == 9` | `len(groups) == 8`, plus a Privacy section of 5 items | Same reason | Owner instruction |
| 7 | 2026-11-02 | `test_standards_docs.py`, glossary terms | Term `counterparty` | Term `entity` | The pack's glossary names this concept `entity` and lists `counterparty` under "Avoid" in code | Owner instruction |
| 8 | 2026-11-02 | `test_standards_docs.py`, ADR contents | 0004 `positions and counts`; 0005 `behaviour-changes.md`; 0006 `PagesDocument`; 0007 `test_ci_defines_no_secrets` | 0004 `codes, positions and counts`; 0005 `mpesa-parser`; 0006 `Runtime dependencies`; 0007 `PagesDocument` | ADRs renumbered by the pack and by owner instruction | Owner instruction |

## Renames in CP0 tests (entry 2)

**Evidence:** for each of the 11 CP0 test files, the AST of the original from commit ac8684c, with the renames applied and imports sorted, was compared with the AST of the edited file. All 11 are identical. So the only other differences are import order and formatting from `ruff format` and `ruff check --fix`, neither of which changes behaviour. Every assertion the rename touched:

| File | Old assertion | New assertion |
|---|---|---|
| `conftest.py` | `assert name in result.stdout` | `assert name in guard_run.stdout` |
| `conftest.py` | `assert result.returncode == 1, result.stdout + result.stderr` | `assert guard_run.returncode == 1, guard_run.stdout + guard_run.stderr` |
| `test_core_purity.py` | `assert result.returncode == 0, result.stdout` | `assert guard_run.returncode == 0, guard_run.stdout` |
| `test_fixture_provenance.py` | `assert result.returncode == 0, result.stdout` | `assert guard_run.returncode == 0, guard_run.stdout` |
| `test_imports.py` | `assert result.returncode == 0, result.stdout + result.stderr` | `assert guard_run.returncode == 0, guard_run.stdout + guard_run.stderr` |
| `test_risky_types.py` | `assert result.returncode == 0, result.stdout` | `assert guard_run.returncode == 0, guard_run.stdout` |
| `test_scan_patterns.py` | `assert 'a.txt: 3 ' in result.stdout` | `assert 'a.txt: 3 ' in guard_run.stdout` |
| `test_scan_patterns.py` | `assert result.returncode == 0, result.stdout` | `assert guard_run.returncode == 0, guard_run.stdout` |
| `test_scan_patterns.py` | `assert result.returncode == 1` | `assert guard_run.returncode == 1` |
| `test_secrets.py` | `assert '0 commits' in result.stdout` | `assert '0 commits' in guard_run.stdout` |
| `test_secrets.py` | `assert result.returncode == 0, result.stdout` | `assert guard_run.returncode == 0, guard_run.stdout` |
| `test_wheel.py` | `assert '1 ' in result.stdout` | `assert '1 ' in guard_run.stdout` |
| `test_wheel.py` | `assert name in result.stdout` | `assert name in guard_run.stdout` |
| `test_wheel.py` | `assert result.returncode == 0, result.stdout` | `assert guard_run.returncode == 0, guard_run.stdout` |
| `test_wheel.py` | `assert result.returncode == 1` | `assert guard_run.returncode == 1` |

## Other edits to tests written during the standards amendment

These tests were new and not yet passing when edited, and no assertion changed.

- `test_python_lint.py` and `test_js_lint.py`: comprehension variables `n`, `f` and `m` became `i`, `file_report` and `message`, for rule 1.2.
- `test_function_docstrings.py`: a long expression moved into the variable `inner_body`, for line length. The planted source is unchanged.
- `test_banned_names.py`, `test_function_docstrings.py` and `test_js_lint.py`: long string literals split across lines. The strings are unchanged.
- `test_error_message_safety.py`: removed unused imports.
- `test_standards_docs.py`: loop variable `item` became `checkbox`, for rule 1.2. `check_banned_names.py` caught this in a test written during the docs merge.

## Edits to tests written during CP1

No test committed before CP1 was edited. These tests were new and still red or just written when edited. No assertion was weakened to hide a failure.

| Test | Old | New | Reason |
|---|---|---|---|
| `test_scan_patterns.py`, near-miss list | Included `ZZ` plus 9 characters | Removed | An 11-character token is not a finding under guard 1, so this case could never fail. The test was wrong |
| `test_skip_policy.py`, pytest command | Passed `-c skip_allowlist.toml` | Removed | Pytest rejected the allowlist as a config file when it held an entry. Test harness bug |
| `test_layout_profile.py`, error cases | `returncode == 2` | Also requires `layout_profile: ERROR` in stdout | Stricter. A missing script also exits 2, so these were false greens before the tool existed |
| `test_generator.py` | Variable `item`, long lines, `zip` without `strict` | `text_item`, wrapped, explicit `strict` | Rule 1.2 and lint. Renames only |
| `test_ledger.py`, helper | Parameter `receipt` | Removed, unused | PLR0913 |

## Edits for CP2

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_fixtures.py`, `COMMITTED` list | 4 fixture names | 6, adding F-DENSE and F-MANY-PAGES | The manifest test must list the new hostile fixtures. The assertions are unchanged |
| `test_generator.py`, `test_layout_model_matches_what_the_pdf_really_draws` | `min(abs(word["top"] - text_item["top"]) ...) <= 0.5` | `min(abs(word["top"] - pdfminer_top) ...) <= 0.5`, where `pdfminer_top = text_item["top"] + 0.207 * size` | Owner decision: the model now uses pdf.js's vertical reference, so comparing it with pdfplumber needs the known offset. The tolerance is unchanged |
| `test_generator.py`, all reads of generator output | `outputs[".items.json"]` | `outputs[".model.json"]` | `items.json` now holds recordings from pdf.js. The generator's model moved to `model.json`. The assertions are unchanged |
| `test_fixtures.py`, `SUFFIXES` | `.pdf`, `.items.json`, `.expected.json` | `.pdf`, `.model.json`, `.expected.json` | Same reason. These are the regenerable files; new tests cover the recorded ones |

## Edits for the layout profiler's password prompt

Owner instruction: a hidden prompt only, never the command line or the environment.

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_encrypted_pdf_opens_with_a_password_from_the_environment` | `profile["anchor_row_count"] == str(row_count)`, using `--password-env` | Replaced by `test_encrypted_pdf_profiles_correctly_with_the_password_on_stdin`, same assertion, password on stdin | The environment route was removed on purpose |
| `test_password_is_not_a_command_line_value` | `"--password-env" in source`; `--password` exits 2 | Replaced by `test_password_options_are_rejected_on_the_command_line`: 4 forms exit 2 as unrecognized | `--password-env` must now be rejected. Stricter |
| `test_encrypted_pdf_without_a_password_stops_without_printing_text` | Same assertions | Renamed `test_no_password_given_stops_without_printing_text`, and also requires the prompt on stderr | The tool now prompts first. Stricter |
| `run_profiler` helper | Inherited stdin | Takes `typed`; stdin is empty by default | A test must never wait on a prompt |

## Edits for CP3

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_fixtures.py`, `COMMITTED` list | 6 fixture names | 14, adding the 8 calibration fixtures | The manifest test must list them. The assertions are unchanged |

Added to existing files, not edits: new tests in `test_ledger.py` and `test_standards_docs.py`.

These tests were new and not yet committed when edited. No assertion was weakened to hide a failure.

| Test | Old | New | Reason |
|---|---|---|---|
| `test_continuation_lines_print_above_the_anchor` | Compared with the first item holding the receipt | Requires a receipt and first fragment exactly the wrap distance apart | Test bug: a parent and fee share a receipt, so the first match could be the other row |
| `test_rows.py`, 3 continuation and moved-page tests | Removed rows or used 2 moved rows | Built from rows that still calibrate | Test bug: the statements could not calibrate, so they would have failed for the wrong reason |
| `test_export_baseline.py`, refusal and password-option tests | `returncode == 2` | Also require the tool's own message | Stricter. A missing script also exits 2, so 9 tests were false greens before the tool existed |
| `test_export_baseline.py`, bytecode test | No exit-code check | Requires a successful run | Stricter. It passed with no tool |
| `test_compare.py`, 8 "never appears" tests | Asserted absence only | Also prove the tool ran, by a count or exit code | Stricter. A crash also prints nothing, so they passed with no tool |
| `test_compare.py`, `test_mismatch_features_are_counted` | Row 0 and a row with long details; `>=` on text | Rows chosen for exactly one feature each; `==` | Test bug: a text comparison, and rows that could hold two features |
| `test_compare.py`, status-shown test | Value anywhere in the output | The value in a status line | Test bug: `ab` is a substring of ordinary labels |
| `test_compare.py`, planted-text test | `old_only == 1` | `old_only == 3` | Test bug: it plants three receipts that pair with nothing |
| `test_compare.py`, `test_summary_label_not_on_the_statement_reads_not_found` | Asserted `true` under a name saying `not_found` | Removed | The name was wrong. `test_reconcile.py` covers not found |

## Fixture changes for CP3

Generator version 1.3.0. Every `expected.json` gained `chain_break_kinds`, `summary_totals` and `summary_reconciliation`. F-TIES now has money-in pairs, so its PDF, model and recording changed. No other committed PDF or recording changed.

## Edits for the restructure (ADR 0010)

Paths, imports and names only. No assertion changed its meaning.

| Test | Old | New | Reason |
|---|---|---|---|
| Tests reading fixtures (14 files) | `fixtures/synthetic` | `tests/fixtures/synthetic` | The fixtures moved |
| Tests importing the core (6 files) | `mpesa_core.columns`, `.rows`, `.reconcile` | `mpesa_core.extraction.columns`, `.extraction.rows`, `.reconciliation.reconcile` | The core moved into stage folders |
| `test_imports.py`, `test_synth_independence.py` | Planted `rows.py`, `normalize.py` and `analytics/` at the top of the core | Planted at `extraction/rows.py`, `cleaning/normalize.py` and `analysis/` | The planted package must match `.importlinter`, which names the new paths. Test ids are unchanged |
| `test_imports.py` | `test_analytics_may_not_import`, `..._bridge_indirectly` | `test_analysis_may_not_import`, `..._bridge_indirectly` | The package is now `analysis` |
| `test_js_lint.py`, `test_node_tool.py`, `test_banned_names.py`, `test_function_docstrings.py` | Planted under `engine/` | Planted under `pdf_reader/` | The guards' source roots moved |
| `test_pdf_location.py` | Sibling `fixtures/other/a.pdf` fails | `tests/fixtures/other/a.pdf` fails, and so does the old home `fixtures/synthetic/a.pdf` | One new parameter, by owner decision |
| `test_pdf_reader_wiring.py` (was `test_engine_wiring.py`) | CI runs `engine/tests/*.test.js` | CI runs `tests/pdf_readers/*.test.js` | The Node tests moved |
| Test names with "engine" (6 Python, 3 Node) | for example `test_rows_from_both_engines_are_equal` | `test_rows_from_both_readers_are_equal` | Glossary term. Names about the `engine` contract field keep it |

## Edits for CP4

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_export_baseline.py`, fake old repo | Held `src/extract.py` only | Also holds stand-ins for `src/security.py` and `src/clean.py` | The export now runs the old pipeline's decrypt, extract and clean steps, as the old pipeline does |
| `test_password_comes_from_the_prompt_and_reaches_the_old_code` | The extractor received the password: balance equals it | The old decrypt step received it: balance equals the decrypted stream's text | In the old pipeline the password goes to decryption, and the extractor reads the decrypted stream |
| `test_blank_password_reaches_the_old_code_as_none` | Same, with None | Same change | Same reason |
| `test_function_with_no_password_parameter_works_when_none_is_typed` | An extractor without a password parameter works | Replaced by `test_extractor_receives_the_decrypted_stream_not_a_path` | The extractor never takes a password in the old pipeline; it takes a stream |
| `test_old_module_and_function_are_named_constants` | Two constants | Also the decrypt and clean constants | New old steps |
| `test_compare.py`, `write_baseline` helper | Wrote the baseline only | Also writes `canonical.json` beside it, built with `canonicalize_rows`, under the old cleaning step's names | `compare.py` now needs it. Tests that change it on purpose say so |
| `test_final_lines_are_the_agreed_gates` | 8 gates | 12, adding the 4 canonical gates | Owner instruction |
| `test_details_mismatch_is_counted_but_is_not_a_gate` | `returncode == 0` | Renamed `..._and_fails_only_the_canonical_details_gate`: the only failing gate is `zero_mismatch_details_normalized` | A details difference now also reaches the canonical rows, and that gate is new by owner instruction. The stage-1 gates still pass |
| `test_status_mismatch_passes_when_counted_and_shows_classes` | `returncode == 0` | The only failing gate is `zero_mismatch_status`; `status_mismatches` still passes | Same reason, for status |

Added to existing files, not edits: tests in `test_rows.py`, `test_differential.py`, `test_export_baseline.py` and `test_compare.py`. `tests/core/conftest.py` gained one line putting its own folder on `sys.path`, so the data modules beside it import under CPython and Pyodide.

New tests corrected while still red: `synthetic_details.py` and `test_normalize.py` used a 10-character reference containing a digit and a literal masked phone, both of which the pattern guard rejects outside the fixtures. They became a letters-only reference and an assembled masked phone.

## Edits for CP5

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_export_baseline.py`, fake old repo | Held the decrypt, extract and clean stand-ins | Also holds stand-ins for `src/engine.py` and `src/entity.py` | The export now runs the old classifier and entity step |
| `test_compare.py`, `write_baseline` helper | Wrote the baseline and canonical rows | Also writes `classified.json` in the old format, built with `classify_transactions` | `compare.py` now needs it. A planted row with no amount is classified on its own or skipped, as the old run would have stopped |
| `test_final_lines_are_the_agreed_gates` | 12 gates | 18, adding the 6 classification gates | Owner instruction |
| `test_details_mismatch_is_counted_and_fails_only_the_canonical_details_gate` | The only failing gate is the canonical details gate | Every stage-1 gate passes and the canonical details gate fails | A changed details text now also changes the old classification, so classification gates fail too. The point of the test, that details are not a stage-1 gate, is unchanged |

The three log tests in `test_behaviours.md` were rewritten for the new seam, as the plan says (REWRITE), in `tests/core/test_diagnostics.py`. Writes a structured event became `test_unresolved_row_is_returned_as_a_structured_diagnostic`. Appends separate records became `test_each_unresolved_row_is_a_separate_diagnostic_in_the_old_order`. Accepts a string log path became `test_diagnostics_are_returned_and_nothing_is_logged_or_written`.

## Edits for CP6

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_no_pandas.py`, `test_no_core_module_imports_pandas` | No core module imports pandas | Renamed `..._outside_analysis_...`: no module outside `analysis` imports pandas; new tests check that `analysis/__init__.py` imports nothing at load, and that pandas is the pinned optional extra | Owner decision (ADR 0006): pandas allowed in `analysis` only |
| `test_contracts.py`, `test_importing_the_contracts_does_not_load_pandas` | `"pandas" not in sys.modules` | Importing the contracts in a fresh module table does not load pandas | The old assertion depended on test order: once an analysis test has run, pandas is loaded in the same process. The meaning is unchanged |
| `test_imports.py`, `test_synth_independence.py`, planted packages | Planted a few core modules | Also plant `classification`, `reconciliation`, `errors`, `pipeline` and `types` | The new import-linter contract names them, and import-linter fails on a named module that does not exist. Test ids are unchanged |
| `test_wheel.py`, `wheel` helper | Wrote empty files | Also takes METADATA text | The wheel check now reads declared dependencies |
| `test_rows.py`, `test_other_lines_are_located_by_page_and_offset_from_the_header` | A line above a later page's header is `other`, at offset -15 | A stray line between rows is `other`, at offset 110 | That line is now a page heading, by owner instruction. A new test pins the page heading |
| `test_rows.py`, four counting tests | Four kinds of line outside rows | Five, adding `page_heading` | Same reason |
| `test_compare.py`, `write_baseline` helper | Wrote baseline, canonical and classified rows | Also writes `report.json`, built with `analyze_transactions` | `compare.py` now needs it |
| `test_final_lines_are_the_agreed_gates` | 18 gates | 19, adding `report_paths_equal` | Owner instruction |
| `test_export_baseline.py`, fake old repo | Held stand-ins up to the entity step | Also holds `src/analytics.py` | The export now runs the old analytics |

The 94 tests in `cp6_test_behaviours.md` were written for the new seam. Old tests that asserted on a frame now assert on the same function's frame turned into records, or, where the old test drove the orchestrator, on the report from `analyze_transactions`. The meaning of each is kept; the names are the old ones. Two were read from their names alone, because only names were supplied: `test_orchestrator_excludes_heavy_hitters_and_keeps_calc_count` and `test_orchestrator_calls_existing_calculations_without_recalculation`.

New tests corrected while still red: the malformed-dates test was narrowed to monthly expenditure, because under the pinned pandas the old code raises on a missing date in date-based analyses (A-3); a separate test pins that. Two report-diff tests pointed at largest purchases, which the synthetic fixtures leave empty, and now point at largest transfers.

## Guard changes made during CP0 (not test edits, recorded for review)

| # | Guard | Change | Condition |
|---|---|---|---|
| 1 | Guard 1 (patterns) | Skip digit and receipt matches inside a complete 40- or 64-character hex hash | The token must be entirely hex and exactly 40 or 64 characters. A test plants a receipt-like token next to a hash and must still fail |
| 2 | Guard 1 | Also catches phone numbers with separators and phone numbers in file names (names redacted in output) | None |
| 3 | Guard 7 (core purity) | Also bans `importlib` and `builtins` | None |

## Config changes, not test edits

| # | File | Change | Reason |
|---|---|---|---|
| 1 | `pyproject.toml` | S110 `check-typed-exception = true` | The S110 plant failed at first. S110 ignores typed excepts by default, and those swallow errors just as silently, so the config was fixed rather than the test |
| 2 | `pyproject.toml` | `tools/**` ignores T201 | Owner decision: tools exist to print file names and counts |

## Guard changes made during CP1

| # | Guard | Change | Condition |
|---|---|---|---|
| 1 | Guard 1 (patterns) | Honours fake receipts and masked fake phones | Inside `fixtures/synthetic/` only. See ADR 0003 |
| 2 | Guard 1 | Skips PDF cross-reference offsets | Inside `fixtures/synthetic/*.pdf` only, with three leading zeros and the `NNNNN n` form |
| 3 | Guard 6 (imports) | Also checks the `synth` package | `synth` may not import `mpesa_core` |

## Edits for CP7a

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_cash_flow_and_spending.py`, `test_unreadable_date_in_a_date_based_analysis_raises_as_the_old_code_does` | `pytest.raises(TypeError)` | `pytest.raises(AnalysisError)` | Owner instruction: a pandas failure becomes a typed error with a code. The meaning, that the analysis stops (A-3), is unchanged |
| `test_compare.py`, `old_report` helper | Caught `TypeError` | Catches `AnalysisError` | Same reason |
| `test_ledger_agreement.py`, `test_closing_balance_with_a_tied_latest_time_is_one_of_the_tied_rows` | Report closing balance `in latest_balances(name)` | Replaced by `test_closing_balance_with_a_tied_latest_time_is_the_newest_row_in_print_order`: `balances` closing equals the ledger's, to the cent | Owner instruction: D-06 decided, print order |
| `test_standards_docs.py`, `test_figure_changing_items_are_deferred` | D-06, A-1, A-2, A-3 | A-1, A-2, A-3; a new test checks D-06 is Done | D-06 is decided |
| `test_errors.py`, `test_attestation_error_can_state_counts` and `test_attestation_error_rejects_string_counts` | `AttestationError(expected_count=..., found_count=...)` | `AttestationError(AttestationCode.TOKEN_MISSING, ...)`, same assertions | Owner instruction: attestation errors carry a code; the constructor now requires one |
| `test_layout_profile.py`, `test_multi_line_share_matches_the_layout_model` | `share * row_count <= wrapped_lines` | `round(share * row_count) <= wrapped_lines` | Test bug exposed by the new fixtures: the profile prints the share to two places, so 25 of 60 rows reads 0.42, and 0.42 × 60 = 25.2 exceeds 25 |
| `test_compare.py`, `test_none_and_empty_string_are_equal_after_strip` | The simulated old report was built from the padded rows | It is built from the unpadded rows; the padded rows still go to stage 1, and the assertion is unchanged | Exposed by the new fixtures: largest purchases are no longer empty, so padded receipts reached the simulated report. The real old export writes its report from real rows, never padded ones |

New tests corrected while still red: the pipeline tests' money-in row first had neither amount (a test bug: it raised `DomainRowError`), and `transfer_row` took six arguments (PLR0913).

## Fixture changes for CP7a

Generator version 1.5.0. Every fixture regenerated and re-recorded from pdf.js. Details now read as each event type's grammar (with short single-line forms for the narrow cases), page 1's footer prints the M-PESA brand and verification instruction beside the page number, and its token mixes letters and digits. `expected.json` gained `verification_token`, `event_type_counts` and `built` (the event type and entity the generator wrote, per row, beside `rows`, which keep the `RawRow` fields only). F-DENSE went from 10 to 14 rows: the new draws gave it a single money-in row, which cannot calibrate (D-10); a new test pins two values per amount column on every fixture. ADR 0008's recorded golden profile was updated to the new output.

## Edits for CP7a-3

Owner instruction: replace the invented summary labels with the real summary block, and change `--labels` and the chain diagnostics. Every edit below follows from that.

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_reconcile.py`, the ten `summary_reconciliation` tests | Each invented label (Transaction Count, Total Paid In, Total Withdrawn, Opening Balance, Closing Balance) agrees, disagrees or is not found | Removed; `test_summary.py` covers the TOTAL row and the type rows, and `test_balances.py` still covers balances on a tied time | The labels and `summary_reconciliation` are gone |
| `test_generator.py`, summary tests | Each invented label's value equals the ledger's; `Transaction Count` equals the row count; `Total Paid In` on page 1 only | TOTAL equals the ledger's totals; the seven type rows print in order and add up to TOTAL; the block sits between its markers below the name, phone and email; the invented labels are absent; `TOTAL:` on page 1 only | Same |
| `test_ledger.py`, summary tests | `summary_totals` and `summary_reconciliation` per invented label | `summary_total`, `summary_total_paid_in_matches`, `summary_total_paid_out_matches` and `summary_type_rows_parsed` | Same |
| `test_calibration_fixtures.py`, summary tests | `WRONG_SUMMARY_LABELS` wrong, the rest agree | `WRONG_SUMMARY_TOTALS` (`paid_in`) wrong, paid out agrees, 7 type rows | Same |
| `test_differential.py`, `test_quality_equals_the_ledger` | `summary_reconciliation` per label | The three summary fields | Same |
| `test_compare.py`, `test_summary_reconciliation_is_reported_per_label` | `summary_new_total_paid_in: false` and so on | Replaced by `test_summary_totals_are_reported_as_yes_or_no_per_side` | Same; yes or no as the instruction asks |
| `test_compare.py`, `test_lines_outside_rows_are_broken_down_and_none_is_unexplained` | 7 summary lines, 13 in all | 13 summary lines, 19 in all | Page 1 now prints the name, phone, email, the two markers, seven type rows and TOTAL |
| `test_compare.py`, the three `--labels` tests | Every line above the first anchor, 7 lines, one starting `Total Paid In` | The block only: starts `SUMMARY`, 9 lines, ends with TOTAL, no `DETAILED STATEMENT`; none holds `@`, Customer, Mobile, Email or Name; exit 2 and no output without markers | Owner instruction |
| `test_compare.py`, `test_labels_cannot_be_combined_with_share` | `Total Paid In` not in the output | `SEND MONEY` not in the output | The label it guards changed |
| `test_compare.py`, `test_identity_and_residual_lines_on_a_clean_chain` and `test_planted_breaks_are_unpaired_and_add_up_to_the_gap` | `break_residuals_unpaired_sum_equals_gap` and `chain_breaks_remaining_after_group_reorder` | Removed; `chain_breaks_raw`, `chain_breaks_after_reorder`, per-rule and remaining-break lines added | Owner instruction removed the first; the second duplicated `chain_breaks_after_reorder` |
| `test_pdfplumber_reader.py`, `test_positions_agree_with_pdfjs_for_the_same_text` | Twin found by nearest top only | Nearest top, then nearest x0 | Test weakness exposed by the new fixtures: a summary row prints `0.00` twice on one line, so top alone picked the wrong twin. Tolerance unchanged |
| `test_compare.py`, `test_mismatch_features_are_counted` | Changed details on a wrapped row inside page 1 and paid in on a single-line row last on a later page | Details on a single-line row inside page 1, paid in on a wrapped row first or last on a later page; same four counts asserted | The new draw of F-MULTIPAGE has no single-line row at a later page's edge, so the row search found nothing. Each feature is still hit exactly once |
| `0008-layout-profile-synthetic.md` (read by `test_decision_record_holds_the_current_golden_output`) | Generator 1.5.0 output | Generator 1.6.0 output | Positions moved by hundredths of a point with the new page 1 |

New tests corrected while still red: a four-amount summary row in `test_summary.py` lost its fourth cell for want of a fourth x position, and `test_quality_counts_breaks_before_and_after_reordering` used rows that read best oldest first, where the quality records 1 break and reordering cannot help; it now adds older rows so newest first is recorded, and asserts 2 breaks before and 0 after.

## Fixture changes for CP7a-3

Generator version 1.6.0. Every fixture regenerated and re-recorded from pdf.js. Page 1 now prints an invented name, phone (fake range) and email, then the summary block: `SUMMARY`, seven type rows and TOTAL (invented sums from the generated rows by event type; fees and the rest in OTHERS), then `DETAILED STATEMENT`. A statement without rows (F-NOTABLE) prints no block. F-SUMMARY-MISMATCH prints TOTAL paid in wrong. `expected.json` replaced `summary_totals` and `summary_reconciliation` with `summary_total`, the two `*_matches` fields and `summary_type_rows_parsed`.

## Edits for CP7b

No existing assertion was changed. New tests: `test_identity.py` (the 13 old identity behaviour names, plus field lists, derived fields, earliest match and JSON values), `test_import_plan.py` (the 4 old collision behaviour names, plus repeat imports, overlapping statements, one action per row, validation and errors), `test_bridge.py`, `tests/synth/test_import_plan_agreement.py`, and additions to `test_contracts.py` and `test_standards_docs.py`. The old collision tests were marked REWRITE for the browser store (CP9); their decisions are tested here against the plan, and the store will still need its own tests.

New tests corrected while still red: in F-RECORDS the changed details value equalled record 2's own details, so the property-style test's precondition failed for that record; the changed value is now distinct. A docs needle (`src/persistence/orchestration.py` in PORT_MAP) was already present, so it could not fail first; it was replaced by `plan_statement_import`.

## Edits for CP8a

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_pipeline.py`, `RESULT_FIELDS` (read by `test_result_has_exactly_the_contract_fields`) | Nine result fields | Ten: `account_digest` added | CP8a item 1: the result carries the digest of page 1's mobile number |
| `test_pipeline.py` and `tests/synth/test_pipeline_fixtures.py`, `composed()` (read by `test_run_equals_the_composition_of_the_stages`) | The stages without the digest | Adds `account_digest(statement_pages)` and `quality["account_number_unreadable"]` | Same; the composition must stay the stages called one by one |
| `tests/synth/test_pipeline_fixtures.py`, `INVENTED_IDENTITY` (read by the recursive privacy scan) | Name, local phone, national digits, email and its parts | Adds the canonical `254` form of the phone | Owner instruction: extend the recursive scan so no form of the number appears |
| `tests/pdf_readers/limits.test.js`, `the page limit is configurable in both directions` | Reading F-MANY-PAGES with `pageLimit: DEFAULT_PAGE_LIMIT + 1` gives `DEFAULT_PAGE_LIMIT + 1` pages | With `pageLimit: 501` (F-MANY-PAGES's count) gives 501 pages, and 501 exceeds the default | CP8a item 7 set the default page limit to 300 from measurement; the fixture still has 501 pages, so the old arithmetic no longer names its count |
| `tests/synth/test_hostile_fixtures.py`, `test_many_pages_fixture_exceeds_the_default_page_limit` | Page count `== DEFAULT_PAGE_LIMIT + 1`, read from `adapter.js` | Page count `>` the page limit, read from `pdf_reader/limits.js` | Same; the limit now lives in `limits.js`, and the fixture only needs to exceed it |
| `tests/synth/test_hostile_fixtures.py`, `test_many_pages_fixture_really_has_that_many_pages` | pdfplumber's page count `== DEFAULT_PAGE_LIMIT + 1` | pdfplumber's page count equals the recorded pages' count and exceeds the page limit | Same |

New tests corrected while still red: `test_run_json_returns_the_pipeline_result_in_an_ok_envelope` compared with `pipeline.run` directly, but JSON turns the integer keys of `receipt_length_histogram` into text; it now compares with the result through JSON, as the browser sees it. `engine_bridge.test.js`, `a core that throws is ENGINE_FAILED`, gained `pandas_load_ms: null` when every outcome started carrying the load time. The browser timeout test first used F-DENSE, which reads in under half a second, and compared the page's round trip with the worker's read time; it now uses a hostile PDF built at test time that takes seconds to read, proven slower than the timeout by the Node reader. The compare share-output test passed while the tool only printed usage to stderr; it now asserts a successful run first.

## Edits for CP8a-2

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_compare.py`, `test_digest_presence_must_agree_with_cpython`, renamed `test_digest_presence_is_reported_but_excluded_from_the_gate` | Flipping `account_digest_present` fails `browser_result_equals_cpython` | The gate passes, and `browser_vs_cpython_account_digest_present_agrees: no` is printed | Owner instruction (CP8a-2 item 6c): `account_digest` is left out of the browser output by design, so it is excluded from the comparison explicitly (`EXCLUDED_BY_DESIGN` in `compare.py`). `verification_token` is not left out, so it is still compared |
| `test_compare.py`, `test_browser_result_and_pdf_cannot_both_be_given`, renamed `test_labels_cannot_be_combined_with_a_browser_result` | `--browser-result` with `--pdf` is refused | `--browser-result` with `--pdf` and `--labels` is refused naming `--labels` | Item 6d: `--pdf` beside `--browser-result` now compares the browser's pages with the Node reader's |
| `test_compare.py`, `test_the_lines_are_the_pdf_runs_lines_plus_the_browser_gate` | The browser run's lines without the gate line equal the `--pdf` run's | Without every line naming `browser_` | Item 6 adds `browser_*` count lines |
| `test_compare.py`, `test_shared_browser_output_is_labels_and_counts_only` | The word `browser` appears only in the gate's name | The temporary folder's path does not appear | Same; the check was for the folder name leaking, which the path check covers |
| `desktop_limits.test.js`, `the engine times a run out at the desktop timeout by default` | One microtask flush between timer ticks | A full flush (`setImmediate`) after each tick, with an explicit check that no timeout came early and one came on time | Item 1's mutation check found the test passing with the engine's default timeout changed to 120 s: one flush was not enough for the timeout's promise chain to settle, so `settled` was still null either way |
| `test_python_lint.py`, `test_bundle_budget_is_reported_as_not_enforced`, renamed `test_bundle_budget_is_enforced` | `measure_bundle.py` exits 0 and prints `NOT ENFORCED` | Its source no longer says `NOT ENFORCED`; `test_bundle_budget.py` covers the exit codes | Owner instruction (CP8a-2 item 4): enforce the budget in CI |
| `test_python_lint.py`, `test_bundle_budget_is_not_a_ci_gate`, renamed `test_bundle_budget_is_a_ci_gate` | CI does not run `measure_bundle` | CI runs it | Same |

## Edits for CP8a-3

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `browser_run.test.js`, `an existing output folder is refused` | `browser_run: ERROR (--out must not exist yet)` | `browser_run: ERROR (--out exists: remove the old --out folder first)` | Owner instruction: the error says what to do |

New tests corrected while still red: `test_an_old_report_with_untied_entries_swapped_still_fails` searched F-TIED's ten largest purchases for two adjacent different amounts, but F-TIED ties all ten, so it raised `StopIteration`; renamed `test_an_old_report_whose_sort_values_differ_still_fails`, it changes one amount instead. `test_skip_baseline_needs_a_browser_result` passed before the flag existed, because argparse's "unrecognized arguments" message names the flag; it passes now because the flag refuses to run without `--browser-result`.
| `test_vendor_runtime.py` and `test_bundle_budget.py`, every test using the wheel | Built the runtime from `dist/mpesa_core-0.0.0-py3-none-any.whl` | Build it from a wheel the session builds from the current source (`built_wheel` in `tests/guards/conftest.py`) | CI runs pytest before its "Build wheel" step, so `dist/` was empty there and 2 tests failed with 7 errors; they had passed locally only because an older wheel sat in `dist/`. Same assertions |

## Edits for CP8b

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_pipeline.py` and `tests/synth/test_pipeline_fixtures.py`, `composed()` | `analyze_transactions(transactions)` | `analyze_transactions(transactions, closing_balance=balances["closing_balance"])`, balances measured first | Owner instruction (CP8b item 6, behaviour-changes T-4): the report's closing balance follows print order, as `pipeline.run` now composes it |
| `test_compare.py`, `test_an_old_report_whose_sort_values_differ_still_fails` | `report_paths_tie_order_only` is 0 | No `spending.` path counts as tie order, and the gate fails | Same: F-TIED's closing balance now legitimately differs from the old rule at its tied latest time and counts as tie order; the test is about the changed amount |

Guard and config changes for CP8b: `tools/guards/guards.toml` allows `web/tsconfig.json` among JSON files (the Next.js app's TypeScript config) and prunes `web/.next` and `web/out` (Next's build output, gitignored) from the guard walk. `.prettierignore` leaves the ported prototype (`web/src/`, `web/tests/`) to its own formatting so `docs/web-port-map.md` can record files as unchanged; new files written for CP8b are formatted. `web/tests/fees-browser.test.mjs` line 206: the fees scope selector, whose URL-encoded colon the pattern guard read as a receipt number, became two attribute matches (`scope=fees` and `TRANSFER_OUT&`) that select the same link.

Deleted for CP8b, with where each behaviour is now covered. `web/tests/upload-and-pagination-preservation.test.mjs` tested the prototype's HTTP seam (multipart upload and paged transaction loading), which no longer exists; gitleaks also flagged its placeholder password.

| Deleted test | Why | Now covered by |
|---|---|---|
| M1 "POSTs multipart fields `file` and `password`…", "omits `password` when the statement has none" | No HTTP upload: the PDF goes to the worker | `data-layer.test.mjs` "an engine failure from upload…", `upload-flow-local.test.mjs` "the password goes to the engine once…" |
| M2 "concurrent submissions share one request and one result" | Same behaviour, new seam | `upload-flow-local.test.mjs` "concurrent submissions share one engine run and one result (was M2)" |
| M3 "after success the file and password are forgotten…", "after a non-retryable failure…", "after a retryable failure the file is kept…" | Same behaviour, new seam | `upload-flow-local.test.mjs` "the password goes to the engine once and is not kept…", "a retryable failure keeps the file…; any other forgets it (was M3)", "cancelling … forgets the file and password" |
| M5 "fetches exactly the pages needed…" | No paging: every transaction is in memory | `data-layer.test.mjs` "the repo keeps imports in memory and answers the UI's calls from them" |
| H2 "a failed intermediate page rejects…", "a reported total of 2,345 delivered incomplete…", "an import with no transactions…", "a load where … rejects as incomplete" | No pages can fail or arrive partly | `data-layer.test.mjs` (complete in-memory transactions, equal to the core's count) |

The two tests marked "was M2" and "was M3" passed when written: `upload-flow.ts` keeps that logic unchanged from the prototype, so they pin preserved behaviour rather than new behaviour.

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `tests/guards/test_js_lint.py`, `test_real_repo_eslint_is_clean` | `eslint .` exits 0 | `eslint --config eslint.config.mjs .` exits 0 | ADR 0014: ESLint 10 otherwise picks up `web/eslint.config.mjs` for files under `web/` and crashes in `eslint-plugin-react` |

Lint changes for ADR 0014: the root `eslint.config.mjs` ignores the web app (`web/src/**`, `web/tests/**`) and its config files; `web/eslint.config.mjs` ignores `public/`, `harness/`, `probe/`, `scripts/` and the generated `icon-paths.ts`. `tools/guards/run_node_tool.py` gains a `web-eslint` tool run from `web/`; pre-commit gains an `eslint (web app)` hook and the root hook passes `--config`; CI installs `web/` and runs both.

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `tests/browser/engine.test.js`, `a hostile PDF times out by terminating the worker, and a fresh one serves the next run` | A fixed 2,000,000-operator PDF must take over 4 s in the Node reader (a precondition), then the engine, with a 1 s timeout, returns TIMEOUT within 4 s | The PDF is calibrated in the browser engine itself: read once, made heavier (up to 12,000,000 operators) until this machine takes at least 2 s, then the engine, with a timeout of a quarter of that read time, returns TIMEOUT at the engine stage in under three quarters of it; the next statement still runs on a fresh worker | Failed on GitHub's runner: the fixed PDF read in under a second there, so the precondition at line 170 never timed out and the engine was not reached. It had been calibrated only on the dev laptop (about 10 s). The test now proves the same thing on any machine, and measures the engine it tests rather than the Node build |

CP8b, owner instruction (2026-11-17): the app keeps no verification code of its own. The core reads page 1's printed "dial" instruction into `PipelineResult.verification_instruction` (None when absent or when the line looks like it holds a phone number or an email), and the statement checks card shows it as printed, or "Use the verification instruction printed on your statement." New tests were written first: `tests/core/test_verification_instruction.py` and two in `test_pipeline.py`.

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `test_pipeline.py` `RESULT_FIELDS` and `composed()`, `tests/synth/test_pipeline_fixtures.py` `composed()`, `test_compare.py` `TOP_LEVEL_KEYS` | No `verification_instruction` key | The key is present; `composed()` calls `verification_instruction(pages)` | The new result field; `compare.py`'s `PIPELINE_RESULT_KEYS` names it so its diagnostics print the key, never its value |
| `web/tests/honest-copy.test.mjs`, the passing statement's card | Shows `Verify with Safaricom: dial ${SAFARICOM_VERIFY_CODE}` | Shows the statement's own printed instruction; a new test shows the fallback sentence and no `*NNN#` when it is null; a new test checks no dial code is kept in the copy or the card | Owner instruction: remove the constant |
| `web/tests/honest-copy.test.mjs`, the data layer's checks | No `verification_instruction` | `verification_instruction` from the pipeline result | Same |
| `web/tests/ingest-claims.test.mjs`, welcome, upload and loaded summary | "Private to your account"; "The PDF and its password are never stored"; "has been imported and saved to your account." | "Private on this device"; "The PDF, its password and its transactions never leave this device"; "has been read on this device. Nothing was sent anywhere or stored." | CP8b item 5: the copy says what the app does; same no-unsupported-claims check |
| `web/tests/app-shell.test.mjs`, desktop app bar and footer | A "Sign in" button; footer says "Private to your account" | "Private on this device" and no "Sign in" button; footer says "Private on this device" | CP8b items 3 and 5: there is no account |
| `web/tests/story-navigation.test.mjs`, desktop story tabs | Keeps the "Sign in" account control | Says "Private on this device", no "Sign in" | Same |
| `web/tests/story-navigation.test.mjs`, Breakdown hub links and current tab | Links carry `?import=7` from the query | Plain routes (`/ledger`, `/breakdown/spending`, …; current tab `/breakdown`) | A static export cannot read the query on the server; every page shows the session's latest statement until ledger switching (CP9). The same links are still checked, in the same order |

| Deleted test | Why | Now covered by |
|---|---|---|
| `web/tests/story-navigation.test.mjs` "getImportOrLatest": loads the requested import, loads the most recent, null without imports, rejects another user's import | They faked the HTTP API (`fetch` to `/api/v1/imports…`), which no longer exists | `data-layer.test.mjs` "the repo keeps imports in memory and answers the UI's calls from them" (latest, none, unknown id) |
| `web/tests/browser-csp.test.mjs` (A to F) and `web/tests/frontend-security-headers.test.mjs` (FRONTEND-SEC-01 to 04), with `tests/support/csp.mjs` and `tests/support/test-api.mjs` that only they used | They tested the prototype's server: a per-request nonce CSP from `proxy.ts`, Google Fonts, the login form and the API origin, none of which exists in the static export | `web/tests/static-export-csp.test.mjs` (every route in real Chrome under its hashed CSP, 0 violations, 0 foreign requests) and the real-UI test (`web/tests/e2e-local.test.mjs`) |

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `web/tests/data-layer.test.mjs`, "the import summary is built from…" | `previously_imported_transaction_count: plan.counts.link`, `observation_counts` from `plan.counts.preserve` | `0` and `{}` against an empty session; a new test pins the plan's counts to the core's names (`new`, `matched`, `collided`) and counts matched and collided rows from them | The old assertion read the same wrong field names as the adapter, so `undefined` equalled `undefined` and it passed while the real summary screen crashed (found by the real-UI test, `e2e-local.test.mjs`). The adapter now reads `matched` and `collided` |

New engine tests (CP8b, seen red first): `tests/pdf_readers/engine_client.test.js` "cancel while the runtime is still starting…" (red: the cancel was lost and the statement was read anyway) and "a cancel with no run in progress does not cancel the next statement" (passed at once: with no pending run `cancel()` was already a no-op; it pins that).

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `web/tests/e2e-local.test.mjs`, last test | Every request in every scenario was a GET | Every request kept the request rule (`tools/browser/request_rule.js`): a GET to the app's origin, or a HEAD to one of the app's own pages, never with a body | Owner decision 2026-11-17: Next's link prefetch sends a same-origin HEAD before its GET; it carries no data. `tests/browser/request_rule.test.js` pins what still fails (other origins, POST and the like, a body, a HEAD to a non-page) |

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `tests/guards/test_vendor_runtime.py` `LOADED_PACKAGES` | The runtime ships numpy, pandas, python_dateutil, pytz and six | It ships numpy, pandas, python_dateutil and six, and never pytz; a new test checks the runtime's lock is Pyodide's with only pytz dropped from pandas's dependencies | Owner decision 2026-11-17 (ADR 0006 update): pandas 3 does not need pytz; all 885 core tests passed under Pyodide without it; the download is 0.38 MB smaller and within budget |
| `tests/guards/test_bundle_budget.py`, the analysis files | The pytz wheel is an analysis file | It is not listed: it is no longer shipped | Same |

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `tests/synth/test_fixtures.py`, `test_manifest_lists_exactly_the_committed_outputs` | The manifest lists exactly the generated statements' three outputs each | The same, plus each contract scenario's outputs (`SCENARIO_FIXTURES`: its `.api.json`, and its `.pdf` and `.model.json` when it can be printed) | CP8b, owner decision A: the frontend's contract scenarios are generated fixtures too; still an exact list, nothing unlisted |
| `tests/synth/test_fixtures.py`, `test_manifest_records_each_recorded_file_with_its_source_and_engine` | Every recorded entry is a pdf.js recording of a generated statement | The same checks on the `.items.json` entries; every other recorded entry must be a scenario's `.report.json` | CP8b: the core's reports on the scenarios are recorded fixtures too (`tools/record_scenario_reports.py`, `test_scenario_reports.py`); `record_items.mjs` now keeps entries it does not own |
| `web/tests/statement-rows.test.mjs`, the backend's event types | Read from the old backend's `src/event_types.py` | Read from the core's `src/mpesa_core/classification/taxonomy.py`, the members of `FinancialEvent` only (that file also holds other enums) | The file moved in the port; the assertion (the frontend's event types equal the core's) is unchanged and passes |

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `tests/core/test_columns.py`, a column seen only once / never seen cannot calibrate | `LAYOUT_UNRECOGNIZED` | `TOO_FEW_AMOUNTS` (renamed "…and says too few amounts"); a new test keeps `LAYOUT_UNRECOGNIZED` when no amount prints at all | Owner decision 2026-11-17: this refusal gets its own core code and user message ("too few paid-in or paid-out entries"); the rule itself is unchanged (CP10 list) |
| `tests/core/test_errors.py`, `EXPECTED_CODES` | Eight extraction codes | Nine: `TOO_FEW_AMOUNTS` added | Same |
| `tests/pdf_readers/engine_bridge.test.js`, core codes kept as `core_code`; `web/tests/data-layer.test.mjs`, the covered core codes | Seven core codes | `TOO_FEW_AMOUNTS` too; a new web test checks its own message, which is not the layout one | Same |

CP8b owner decision (1): the seven `web/tests/statement-data.test.mjs` tests faked the HTTP API and asserted the request paths, a seam that no longer exists. Each is replaced at the data layer's seam (`src/data/repo.ts`), with a stand-in engine answering from the contract scenarios (`web/tests/support/scenario-engine.mjs`). None was retired: every behaviour still exists. The replacements passed when first run, because they pin behaviour the app already has; each was then checked by breaking that behaviour on purpose (no integrity check; wrong analytics; no null for an empty session), and the matching tests failed.

| Old test | New test | What changed |
|---|---|---|
| loads the requested import, then its analytics, and nothing else | loads the requested import with its analytics, and asks the engine nothing more | Same result; "nothing else" is now one engine run (the upload) instead of two request paths |
| without an import, loads the latest import and its analytics | without an import, loads the latest import and its analytics | Same; two uploads, the second is the latest |
| is null, with no further request, when the user has no imports | is null, asking the engine nothing, when this session holds no statement | Same; no engine run instead of no request |
| rejects with the API's error for an import that is not the user's | rejects with the data layer's error for an import this session does not hold | `import_not_found` instead of the API's 404 `not_found` |
| loads every row of the import once | loads every row of the import once | Every row, unique ids, equal to `getAllTransactions`, instead of one page request |
| rejects like H2 when the rows don't match the summary (H-4) | rejects like H2 when the rows don't match the summary (H-4) | Same rejection; the summary's count is off by one instead of a short page |
| rejects like H2 when a row moves money both ways (H-5) | rejects like H2 when a row moves money both ways (H-5) | Same rejection; the stand-in engine returns the row |

| Test | Old assertion | New assertion | Reason |
|---|---|---|---|
| `web/tests/static-export-csp.test.mjs`, `ROUTES` and the page files | Routes end in `/` and each is a folder's `index.html` | Routes without the slash, each its `.html` page (the home page `index.html`) | ADR 0015 update: `trailingSlash: false`, keeping the prototype's URLs so its browser tests run unedited; same checks on the same 14 routes |

CP8b owner decision (2): the prototype's ten browser test files run on the static export. Their server helper (`web/tests/support/frontend-server.mjs`) was swapped: it serves `web/out` with its CSP, swaps the engine's worker for a stand-in that reads the import a test names from the test's fake API (through the same origin, so the CSP holds), and adds `openWithImport` and `appGoto`. In each file, `openPage` now reads the import in through `/upload` instead of signing in, and each door is followed with the app's router instead of a full page load, which would forget the in-memory session. Assertions were not changed. Running them found one real defect, Next's built-in 404 page breaking the CSP with inline styles; it now has its own page (`src/app/not-found.tsx`), with a test. Only tests whose behaviour no longer exists were deleted:

| Deleted test | Why its behaviour no longer exists | Still covered by |
|---|---|---|
| `app-shell-browser`, "shell controls on the six pages" (24: six pages, four widths) | Each asserts exactly one visible account button, or opens `/login`: there is no sign-in (CP8b item 3) | `app-shell.test.mjs` (the shell, its tabs and the "Private on this device" label); `static-export-csp.test.mjs` (every route loads) |
| `app-shell-browser`, "sign in and sign out with the visible account button" (2) | No sign-in | `no-login.test.mjs` |
| `app-shell-browser`, "desktop bar fits with the statement chip" (8) | Each asserts the account control fits beside the chip; there is no account control | `story-navigation.test.mjs` (the desktop bar's statement chip) |
| `app-shell-browser`, "failed analytics don't cost the shell its period" (2), "failed transactions keep the import, its period and its ribbon" (1) | They make the server's analytics or transactions request fail (503); the data is in memory and cannot fail to load after an import | `e2e-local.test.mjs` (engine failures reach /recovery) |
| `app-shell-browser`, "upload → processing → recovery → Try Again → analysis summary" (2); `recovery-retry-browser.test.mjs` (2, file deleted) | They wait for the server's error codes (`server_busy`, `statement_password_invalid`) on /recovery; the engine's own codes are shown now | `upload-flow-local.test.mjs` (a retryable failure keeps the file and offers Try again; any other forgets it); `e2e-local.test.mjs` (each failure's message) |
| "analytics fail" and "transactions fail (T-LOADFAIL)" in each area file: cash, fees, hub, money-in, overview, people, savings, spending (16) | Same: an import's analytics and rows are in memory once read, so they cannot fail to load | `statement-data.test.mjs` (rows that fail H-4 or H-5 are rejected) |

Kept and still failing, as findings (owner's rule: a failing assertion is a finding, not an edit): the tests that expect a link to carry the fake API's import id (`?import=5`), or a story link to carry `?import=`. The static app numbers the session's statements from 1 and shows the latest until ledger switching (CP9), so these wait for CP9.
