"""The Pyodide bridge: the only core module JavaScript calls, with JSON text in and out.

Failures are typed errors carrying codes and positions only (ADR 0004); a request's text is never
repeated in a message.
"""

import json

from mpesa_core.errors import ImportPlanCode, ImportPlanError
from mpesa_core.reconciliation.import_plan import plan_statement_import, validate_import_plan

PLAN_REQUEST_FIELDS = {"incoming_rows", "existing_transactions"}
VALIDATE_REQUEST_FIELDS = {*PLAN_REQUEST_FIELDS, "plan"}


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
