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
