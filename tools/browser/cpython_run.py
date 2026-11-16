"""Run mpesa_core.bridge.run_json under CPython for each request on stdin; print the envelopes.

Used by the real-Chrome tests (tests/browser/) to compare the browser's pipeline result with
CPython's on the same statement pages. Synthetic fixtures only.
"""

import json
import sys

from mpesa_core.bridge import run_json

requests = json.load(sys.stdin)
envelopes = [
    json.loads(run_json(request["statement_pages_json"], request["processed_at"]))
    for request in requests
]
json.dump(envelopes, sys.stdout)
