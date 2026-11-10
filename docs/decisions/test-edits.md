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
