"""Independent import planner: the import plan worked out the plain way, for agreement tests.

It must share nothing with the core, so the field lists are written out again here. Every row is
compared with every stored transaction, which is slow but obviously right.
"""

KEY = ("receipt_no", "event_type")
MATERIAL = (
    "receipt_no",
    "event_type",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "paid_out",
    "balance",
)
OBSERVATION = {"category": "unexpected_receipt_event_type_collision"}


def plan_import(incoming_rows, existing_transactions):
    """Plan an import the plain way.

    Args:
        incoming_rows: The statement's transactions, in print order.
        existing_transactions: The transactions already stored, in the order they were stored.

    Returns:
        The plan: an action per row and the counts of new, matched and collided rows.

    Side Effects:
        None.
    """
    store = [
        ({"source": "existing", "index": index}, transaction)
        for index, transaction in enumerate(existing_transactions)
    ]
    actions = []
    for row_index, row in enumerate(incoming_rows):
        same_key = [(name, known) for name, known in store if _same(row, known, KEY)]
        exact = [name for name, known in same_key if _same(row, known, MATERIAL)]
        action = {
            "row_index": row_index,
            "action": "insert",
            "target": None,
            "collides_with": [],
            "observation": None,
        }
        if exact:
            action.update(action="link", target=exact[0])
        elif same_key:
            action.update(
                action="preserve",
                collides_with=[name for name, _ in same_key],
                observation=dict(OBSERVATION),
            )
        if action["action"] != "link":
            store.append(({"source": "incoming", "index": row_index}, row))
        actions.append(action)
    kinds = [action["action"] for action in actions]
    counts = {
        "new": kinds.count("insert"),
        "matched": kinds.count("link"),
        "collided": kinds.count("preserve"),
    }
    return {"actions": actions, "counts": counts}


def stored_after(plan, incoming_rows, existing_transactions):
    """Give what a store holds after applying a plan: added rows join the end, in row order.

    Args:
        plan: The plan applied.
        incoming_rows: The statement's transactions.
        existing_transactions: What the store held before.

    Returns:
        The stored transactions, in the order they were stored.

    Side Effects:
        None.
    """
    added = [
        incoming_rows[action["row_index"]]
        for action in plan["actions"]
        if action["action"] in ("insert", "preserve")
    ]
    return [*existing_transactions, *added]


def _same(first, second, fields):
    """Tell whether two transactions agree exactly on some fields.

    Args:
        first: One transaction.
        second: The other.
        fields: The field names to compare.

    Returns:
        True if every field is equal.

    Side Effects:
        None.
    """
    return all(first[field] == second[field] for field in fields)
