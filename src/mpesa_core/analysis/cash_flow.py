"""Cash flow: money in, money out, net flow and the closing balance.

Every row counts here by its direction, whatever its event type, unclassified rows included.
"""

INFLOW = "INFLOW"
OUTFLOW = "OUTFLOW"


def calculate_total_inflow(frame):
    """Sum the money that came in.

    Args:
        frame: A prepared frame.

    Returns:
        Paid in summed over the lines whose direction is inflow.

    Side Effects:
        None.
    """
    return frame[frame["cash_flow_direction"] == INFLOW]["paid_in"].sum()


def calculate_total_outflow(frame):
    """Sum the money that went out.

    Args:
        frame: A prepared frame.

    Returns:
        Paid out summed over the lines whose direction is outflow.

    Side Effects:
        None.
    """
    return frame[frame["cash_flow_direction"] == OUTFLOW]["paid_out"].sum()


def calculate_net_cash_flow(frame):
    """Work out inflow minus outflow.

    Args:
        frame: A prepared frame.

    Returns:
        The difference.

    Side Effects:
        None.
    """
    return calculate_total_inflow(frame) - calculate_total_outflow(frame)


def calculate_closing_balance(frame):
    """Find the balance of the last transaction by completion time.

    The sort is pandas' default, so which of two rows at the latest time is taken is not promised
    (D-06, deferred). A row with an unreadable time sorts last.

    Args:
        frame: A prepared frame.

    Returns:
        The balance, or 0.0 with no rows.

    Side Effects:
        None.
    """
    if frame.empty:
        return 0.0
    return float(frame.sort_values("completion_time").iloc[-1]["balance"])
