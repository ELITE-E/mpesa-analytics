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
