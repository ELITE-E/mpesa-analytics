"""tools/equivalence/scenario_compare.py: the core against each scenario's ledger, counts only.

Its counts are findings, not failures (CP8b, owner decision A); this checks it runs and prints
only counts and error codes, never a value.
"""

import re
import subprocess
import sys

from conftest import REPO

TOOL = REPO / "tools" / "equivalence" / "scenario_compare.py"
COUNT_LINE = re.compile(r"^[A-Za-z0-9-]+ (rows_ledger|rows_core|differ [a-z_]+): \d+$")
ERROR_LINE = re.compile(r"^[A-Za-z0-9-]+ core_error: [A-Z_]+$")


def test_the_comparison_prints_counts_and_error_codes_only():
    completed = subprocess.run(
        [sys.executable, str(TOOL)], capture_output=True, text=True, check=False
    )
    assert completed.returncode == 0, completed.stderr
    lines = completed.stdout.strip().splitlines()
    assert lines
    for line in lines:
        assert COUNT_LINE.match(line) or ERROR_LINE.match(line), line
