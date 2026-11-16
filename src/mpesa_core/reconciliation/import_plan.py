"""Plan what the browser store must do to save one statement's transactions.

Python decides, JavaScript persists: the plan only describes the work, and the store (CP9) applies
it in one IndexedDB transaction. The rules, in words, are in
``docs/decisions/import-plan-behaviour.md``.
"""

from collections import Counter

from mpesa_core.errors import ImportPlanCode, ImportPlanError
from mpesa_core.reconciliation.identity import (
    CANDIDATE_KEY,
    MATCH,
    MATERIAL_FIELDS,
    NEW,
    resolve_identity,
)

INSERT = "insert"
LINK = "link"
PRESERVE = "preserve"
EXISTING = "existing"
INCOMING = "incoming"
COUNT_NAMES = {INSERT: "new", LINK: "matched", PRESERVE: "collided"}


def plan_statement_import(incoming_rows, existing_transactions):
    """Plan one statement's import, row by row, as the old atomic import did.

    Each row is resolved against the stored transactions and the rows this plan has already added,
    in that order: a row inserted or preserved earlier in the statement is a candidate for later
    rows. A row that is not a record holding every material field raises ``ImportPlanError``
    ``INCOMING_ROW_INVALID`` or ``EXISTING_ROW_INVALID``, with the row's position.

    Args:
        incoming_rows: The statement's transactions, in print order.
        existing_transactions: The transactions already stored, in the order they were stored.

    Returns:
        An ``ImportPlan``: one action per row, in row order, and the counts of each kind. A
        ``NEW`` row is inserted, a ``MATCH`` is linked to the transaction it matched, and a
        ``COLLISION`` is preserved as a row of its own with a domain observation, naming every
        transaction it collided with. Positions only, never a row value.

    Side Effects:
        None.
    """
    _check_rows(existing_transactions, ImportPlanCode.EXISTING_ROW_INVALID)
    _check_rows(incoming_rows, ImportPlanCode.INCOMING_ROW_INVALID)
    stored = list(existing_transactions)
    references = [_reference(EXISTING, index) for index in range(len(stored))]
    positions_by_key = {}
    for position, transaction in enumerate(stored):
        positions_by_key.setdefault(_key_of(transaction), []).append(position)
    actions = []
    for row_index, row in enumerate(incoming_rows):
        positions = positions_by_key.get(_key_of(row), [])
        resolution = resolve_identity(row, [stored[position] for position in positions])
        action = _action_for(row_index, resolution, [references[spot] for spot in positions])
        actions.append(action)
        if action["action"] != LINK:
            positions_by_key.setdefault(_key_of(row), []).append(len(stored))
            stored.append(row)
            references.append(_reference(INCOMING, row_index))
    return {"actions": actions, "counts": _count_actions(actions)}


def validate_import_plan(plan, incoming_rows, existing_transactions):
    """Refuse a plan that is not the one ``plan_statement_import`` makes for these rows.

    The store may check a plan before applying it, so a changed plan cannot preserve a row that
    does not collide, which would make a second copy of a transaction already stored.

    Args:
        plan: The ``ImportPlan`` to check.
        incoming_rows: The statement's transactions, in print order.
        existing_transactions: The transactions already stored, in the order they were stored.

    Raises:
        ImportPlanError: ``REQUEST_INVALID`` if the plan's shape is wrong; ``ROW_ACTION_COUNT``
            if a row has no action or more than one; ``PRESERVE_NOT_COLLISION`` if a row that
            does not collide is preserved; ``PLAN_MISMATCH`` for any other difference. Each
            names the first row involved, if any.

    Side Effects:
        None.
    """
    expected = plan_statement_import(incoming_rows, existing_transactions)
    actions = _checked_actions(plan)
    _check_one_action_per_row(actions, len(incoming_rows))
    for action in sorted(actions, key=lambda each: each["row_index"]):
        wanted = expected["actions"][action["row_index"]]
        if action.get("action") == PRESERVE and wanted["action"] != PRESERVE:
            raise ImportPlanError(
                ImportPlanCode.PRESERVE_NOT_COLLISION, row_index=action["row_index"]
            )
        if action != wanted:
            raise ImportPlanError(ImportPlanCode.PLAN_MISMATCH, row_index=action["row_index"])
    if plan.get("counts") != expected["counts"]:
        raise ImportPlanError(ImportPlanCode.PLAN_MISMATCH)


def _check_rows(rows, code):
    """Check that every row is a record holding every material field.

    Args:
        rows: The rows.
        code: The ``ImportPlanCode`` to raise with.

    Raises:
        ImportPlanError: With ``code`` and the first bad row's position.

    Side Effects:
        None.
    """
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not all(field in row for field in MATERIAL_FIELDS):
            raise ImportPlanError(code, row_index=index)


def _key_of(transaction):
    """Give a transaction's candidate key, for looking candidates up.

    Args:
        transaction: A transaction.

    Returns:
        The values of ``CANDIDATE_KEY``, in that order.

    Side Effects:
        None.
    """
    return tuple(transaction[field] for field in CANDIDATE_KEY)


def _reference(source, index):
    """Name a stored transaction: an existing one, or a row this plan adds.

    Args:
        source: ``EXISTING`` or ``INCOMING``.
        index: Its position among the existing transactions, or its row index.

    Returns:
        A ``PlanReference``.

    Side Effects:
        None.
    """
    return {"source": source, "index": index}


def _action_for(row_index, resolution, candidate_references):
    """Turn one row's identity resolution into its action.

    Args:
        row_index: The row's position in the statement.
        resolution: Its ``IdentityResolution`` against the candidates.
        candidate_references: A reference for each candidate, in the order resolved against.

    Returns:
        An ``ImportAction``.

    Side Effects:
        None.
    """
    outcome = resolution["outcome"]
    if outcome == NEW:
        return _action(row_index, INSERT)
    if outcome == MATCH:
        return _action(row_index, LINK, target=candidate_references[resolution["matched_index"]])
    # The only outcome left is COLLISION.
    return _action(
        row_index,
        PRESERVE,
        collides_with=[candidate_references[index] for index in resolution["candidate_indices"]],
        observation={"category": resolution["anomaly"]},
    )


def _action(row_index, kind, *, target=None, collides_with=(), observation=None):
    """Build an ``ImportAction``.

    Args:
        row_index: The row's position in the statement.
        kind: ``INSERT``, ``LINK`` or ``PRESERVE``.
        target: For ``LINK``, the transaction the row is.
        collides_with: For ``PRESERVE``, every transaction sharing the row's candidate key.
        observation: For ``PRESERVE``, the domain observation to record.

    Returns:
        The action.

    Side Effects:
        None.
    """
    return {
        "row_index": row_index,
        "action": kind,
        "target": target,
        "collides_with": list(collides_with),
        "observation": observation,
    }


def _count_actions(actions):
    """Count the actions of each kind.

    Args:
        actions: The plan's actions.

    Returns:
        ``new``, ``matched`` and ``collided``.

    Side Effects:
        None.
    """
    counts = dict.fromkeys(COUNT_NAMES.values(), 0)
    for action in actions:
        counts[COUNT_NAMES[action["action"]]] += 1
    return counts


def _checked_actions(plan):
    """Check that a plan is a record holding a list of records, each with a row position.

    Args:
        plan: The plan to check.

    Returns:
        Its actions.

    Raises:
        ImportPlanError: ``REQUEST_INVALID`` if the shape is wrong.

    Side Effects:
        None.
    """
    actions = plan.get("actions") if isinstance(plan, dict) else None
    if not isinstance(actions, list) or not all(
        isinstance(action, dict) and type(action.get("row_index")) is int for action in actions
    ):
        raise ImportPlanError(ImportPlanCode.REQUEST_INVALID)
    return actions


def _check_one_action_per_row(actions, row_count):
    """Check that every row has exactly one action, and no action names a row that is not there.

    Args:
        actions: The plan's actions.
        row_count: The number of incoming rows.

    Raises:
        ImportPlanError: ``ROW_ACTION_COUNT``, naming the first row without exactly one action.

    Side Effects:
        None.
    """
    per_row = Counter(action["row_index"] for action in actions)
    for row_index in range(row_count):
        if per_row[row_index] != 1:
            raise ImportPlanError(ImportPlanCode.ROW_ACTION_COUNT, row_index=row_index)
    if set(per_row) - set(range(row_count)):
        raise ImportPlanError(ImportPlanCode.ROW_ACTION_COUNT)
