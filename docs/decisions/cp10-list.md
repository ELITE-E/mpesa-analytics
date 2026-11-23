# CP10 list

Work agreed for CP10, with the tests it must bring. Each item says where it came from.

## Relax column calibration for columns seen once or never

From CP8b (owner decision, 2026-11-17). `extraction/columns.py` places each amount column (paid in, withdrawn, balance) only where at least two values print (`MINIMUM_AMOUNT_VALUES`). A statement with one or no money-in entries, or one or no money-out entries, is refused today with `TOO_FEW_AMOUNTS` and its own user message. Three of the five edge-case scenarios hit it (`tools/equivalence/scenario_compare.py`), and a real statement for a quiet period could too.

CP10 relaxes it, for example by placing a missing column from the header row or from the other two columns, and must test:

- a statement with **0** money-in rows calibrates, and every row's amounts land in the right column;
- a statement with **1** money-in row calibrates the same way (and likewise for 0 and 1 money-out rows);
- a **stray item** to the right of the status column (a lone number that is not an amount column) does not become a column and does not move the real ones;
- the scenario comparison then reads stress, no-spending and savings with no `core_error`.

**Done at CP10a** (behaviour change D-10): the header's label spacing places a column printed once or never; the four tests above exist (`tests/core/test_one_sided_columns.py`, `tests/synth/test_one_sided_fixtures.py`) and `scenario_compare.py` reads stress, no-spending and savings with no `core_error`.
