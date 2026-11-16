"""The Pyodide bridge: the only core module JavaScript calls, with JSON text in and out.

Failures are typed errors carrying codes and positions only (ADR 0004); a request's text is never
repeated in a message.
"""

import json

from mpesa_core import pipeline
from mpesa_core.errors import CoreError, DomainRowError, ImportPlanCode, ImportPlanError
from mpesa_core.reconciliation.import_plan import plan_statement_import, validate_import_plan

PLAN_REQUEST_FIELDS = {"incoming_rows", "existing_transactions"}
VALIDATE_REQUEST_FIELDS = {*PLAN_REQUEST_FIELDS, "plan"}
REQUEST_INVALID = "REQUEST_INVALID"
# A row error names a position, not a code.
DOMAIN_ROW = "DOMAIN_ROW"
# The analysis step needs pandas, which the browser loads only when a run first reaches it.
ANALYSIS_RUNTIME_MISSING = "ANALYSIS_RUNTIME_MISSING"
ANALYSIS_PACKAGES = frozenset({"pandas", "numpy", "dateutil", "pytz", "six"})


def run_json(statement_pages_text, processed_at):
    """Run the pipeline on one statement's pages, for the browser worker.

    Every failure the core raises becomes an error envelope carrying a code and at most a row
    position (ADR 0004), so no traceback or message crosses into JavaScript. An error that is
    not a core error is a bug and propagates.

    Args:
        statement_pages_text: JSON text of the ``StatementPages`` from the PDF reader.
        processed_at: A time chosen by the caller, carried into the result as given, or None.

    Returns:
        JSON text of ``{"ok": true, "pipeline_result": ...}``, or of ``{"ok": false, "error":
        {"code": ..., "row_index": ...}}``. The code is the core error's code, ``DOMAIN_ROW``
        for a row error, ``REQUEST_INVALID`` for text that is not statement pages, or
        ``ANALYSIS_RUNTIME_MISSING`` when the run reached the analysis before pandas was loaded;
        the caller loads it and runs again, which gives the same result because every stage is
        pure.

    Raises:
        ModuleNotFoundError: If a module other than pandas or its dependencies is missing, which
            is a broken install, not a statement problem.

    Side Effects:
        Imports pandas when the run reaches the analysis.
    """
    statement_pages = _read_statement_pages(statement_pages_text)
    if statement_pages is None:
        return _error_envelope(REQUEST_INVALID)
    try:
        pipeline_result = pipeline.run(statement_pages, processed_at=processed_at)
    except DomainRowError as error:
        return _error_envelope(DOMAIN_ROW, error.row_index)
    except CoreError as error:
        return _error_envelope(error.code.value, getattr(error, "row_index", None))
    except ModuleNotFoundError as error:
        if error.name not in ANALYSIS_PACKAGES:
            raise
        return _error_envelope(ANALYSIS_RUNTIME_MISSING)
    return json.dumps({"ok": True, "pipeline_result": pipeline_result})


def _read_statement_pages(statement_pages_text):
    """Read statement pages from JSON text, without repeating any of it.

    Args:
        statement_pages_text: The JSON text.

    Returns:
        The statement pages, or None if the text is not a JSON object holding a list of pages.

    Side Effects:
        None.
    """
    try:
        statement_pages = json.loads(statement_pages_text)
    except TypeError, ValueError:
        # The parse error can quote the text, so only the fact of failure is kept.
        return None
    is_pages = isinstance(statement_pages, dict) and isinstance(statement_pages.get("pages"), list)
    return statement_pages if is_pages else None


def _error_envelope(code, row_index=None):
    """Describe a failed run in codes and positions only.

    Args:
        code: The failure's code.
        row_index: The row's position in print order, if the failure has one.

    Returns:
        JSON text of the error envelope.

    Side Effects:
        None.
    """
    return json.dumps({"ok": False, "error": {"code": code, "row_index": row_index}})


def plan_statement_import_json(request_text):
    """Plan a statement's import for the browser store.

    Text that is not such a request raises ``ImportPlanError`` ``REQUEST_INVALID``; bad rows
    raise as ``plan_statement_import`` does.

    Args:
        request_text: JSON text of an object holding exactly ``incoming_rows`` and
            ``existing_transactions``, each a list of transactions.

    Returns:
        JSON text of the ``ImportPlan``.

    Side Effects:
        None.
    """
    request = _read_request(request_text, PLAN_REQUEST_FIELDS)
    plan = plan_statement_import(request["incoming_rows"], request["existing_transactions"])
    return json.dumps(plan)


def validate_import_plan_json(request_text):
    """Check a plan before the browser store applies it.

    Text that is not such a request raises ``ImportPlanError`` ``REQUEST_INVALID``; a plan that
    is not valid raises as ``validate_import_plan`` does.

    Args:
        request_text: JSON text of an object holding exactly ``incoming_rows``,
            ``existing_transactions`` and the ``plan`` to check.

    Returns:
        JSON text of ``{"valid": true}``.

    Side Effects:
        None.
    """
    request = _read_request(request_text, VALIDATE_REQUEST_FIELDS)
    validate_import_plan(
        request["plan"], request["incoming_rows"], request["existing_transactions"]
    )
    return json.dumps({"valid": True})


def _read_request(request_text, fields):
    """Read a request: a JSON object with exactly the given fields, its row lists being lists.

    Args:
        request_text: The JSON text.
        fields: The field names the object must hold, and no others.

    Returns:
        The request object.

    Raises:
        ImportPlanError: ``REQUEST_INVALID`` otherwise. The parse error, which may quote the
            text, stays in ``__cause__``.

    Side Effects:
        None.
    """
    try:
        request = json.loads(request_text)
    except (TypeError, ValueError) as error:
        raise ImportPlanError(ImportPlanCode.REQUEST_INVALID) from error
    is_valid = (
        isinstance(request, dict)
        and set(request) == fields
        and all(isinstance(request[name], list) for name in PLAN_REQUEST_FIELDS)
    )
    if not is_valid:
        raise ImportPlanError(ImportPlanCode.REQUEST_INVALID)
    return request
