"""Decide whether a transaction is new, already known, or in conflict with one already known.

Pure: nothing is stored, inserted or changed. The rules, in words, are in
``docs/decisions/identity-behaviour.md``.
"""

NEW = "new"
MATCH = "match"
COLLISION = "collision"
# Only transactions sharing both values can be the same transaction.
CANDIDATE_KEY = ("receipt_no", "event_type")
# What must be equal for a candidate to be the same transaction. ``status`` is the old
# ``transaction_status``. ``total_cost`` is left out: fee attribution derives it, so it is not
# part of what the statement printed.
MATERIAL_FIELDS = (
    "receipt_no",
    "event_type",
    "completion_time",
    "details",
    "status",
    "paid_in",
    "paid_out",
    "balance",
)
COLLISION_CATEGORY = "unexpected_receipt_event_type_collision"


def fingerprint(transaction):
    """Give a transaction's material fingerprint. A missing material field raises ``KeyError``.

    Args:
        transaction: A ``ClassifiedRow``, or any map holding the material fields.

    Returns:
        The values of ``MATERIAL_FIELDS``, in that order. Fingerprints compare by exact equality.

    Side Effects:
        None.
    """
    return tuple(transaction[field] for field in MATERIAL_FIELDS)


def resolve_identity(incoming, candidates):
    """Resolve whether an incoming transaction is one of the candidates.

    Args:
        incoming: The incoming transaction.
        candidates: Transactions already known, in the order they were stored. Only those sharing
            the incoming transaction's ``CANDIDATE_KEY`` are compared; the rest are ignored.

    Returns:
        An ``IdentityResolution``. ``NEW`` when no candidate shares the key; ``MATCH`` when one
        has the same fingerprint, the earliest if several do, its position in
        ``matched_index``; otherwise ``COLLISION``, with ``COLLISION_CATEGORY`` as the anomaly.
        ``candidate_indices`` lists the positions of every candidate sharing the key.

    Side Effects:
        None.
    """
    key = _candidate_key(incoming)
    indices = [index for index, known in enumerate(candidates) if _candidate_key(known) == key]
    if not indices:
        return _resolution(NEW, indices)
    incoming_fingerprint = fingerprint(incoming)
    for index in indices:
        if fingerprint(candidates[index]) == incoming_fingerprint:
            return _resolution(MATCH, indices, matched_index=index)
    return _resolution(COLLISION, indices, anomaly=COLLISION_CATEGORY)


def _candidate_key(transaction):
    """Give a transaction's candidate key.

    Args:
        transaction: A transaction.

    Returns:
        The values of ``CANDIDATE_KEY``, in that order.

    Side Effects:
        None.
    """
    return tuple(transaction[field] for field in CANDIDATE_KEY)


def _resolution(outcome, candidate_indices, *, matched_index=None, anomaly=None):
    """Build an ``IdentityResolution``.

    Args:
        outcome: ``NEW``, ``MATCH`` or ``COLLISION``.
        candidate_indices: Positions of the candidates sharing the key.
        matched_index: Position of the matched candidate, for ``MATCH`` only.
        anomaly: The observation category, for ``COLLISION`` only.

    Returns:
        The resolution, plain JSON values only.

    Side Effects:
        None.
    """
    return {
        "outcome": outcome,
        "matched_index": matched_index,
        "candidate_indices": candidate_indices,
        "anomaly": anomaly,
    }
