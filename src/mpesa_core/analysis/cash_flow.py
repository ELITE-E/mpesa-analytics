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

    Of several rows at the latest time, the one with the highest receipt number is taken (CP8a-3);
    the old code's default sort left this undefined. A row with an unreadable time sorts last.

    Args:
        frame: A prepared frame.

    Returns:
        The balance, or 0.0 with no rows.

    Side Effects:
        None.
    """
    if frame.empty:
        return 0.0
    ordered = frame.sort_values(by=["completion_time", "receipt_no"], kind="stable")
    return float(ordered.iloc[-1]["balance"])
