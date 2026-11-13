# Analysis behaviour of mpesa-parser

What the old analytics package (`analytics/*.py`) does, read from the porting source (CP6). This is the specification `src/mpesa_core/analysis/` ports. It describes behaviour only; nothing is copied from the old docstrings or comments.

The old pipeline hands the analytics the classified rows, with entities, in print order. The analytics return one result whose JSON-safe form is the report.

## Preparation

Before any analysis, the rows are copied and given these extra fields, without overwriting an existing one:

- **The completion time is parsed** as a date and time. An unreadable value becomes "no time" (A-2 and A-3 below).
- **`date`** is that parsed time.
- **`amount`** is the total cost, or paid out if there is no total cost.
- **`investment_amount`** is paid out.
- **`merchant`, `recipient` and `platform`** are all the entity.

**The period** defaults to the earliest and latest readable completion times. With no rows, or no readable time, it is the earliest and latest dates the language allows.

Most analyses compare calendar dates. Fees compare full times.

**Unidentified entities:** an entity that no grammar read is kept as a fixed marker. "Excluding unidentified entities" means dropping rows that carry the marker. Analyses that do not drop them can show the marker as a name in the report.

## Report keys, exactly as `to_json_safe()` produces them

```
cash_flow:    total_inflow, total_outflow, net_cash_flow, closing_balance
spending:     monthly_expenditure [ month, expenditure ]
              top_recipients [ recipient, amount_received, ranking ]
              largest_purchases [ transaction, recipient, amount, date, ranking ]
              spending_by_entity [ entity, amount ]
              merchant_usage_frequency [ merchant, transaction_count, ranking ]
              recurring_purchases [ merchant, occurrences, dates, intervals, amounts, recurrence_interval ]
bills:        recurring_bills [ bill, occurrences, dates, intervals, amounts ]
              bill_spending [ bill, amount, period { start, end } ]
investments:  total_investment { period { start, end }, investment_amount }
              by_platform [ platform, amount_invested ]
              frequency { investment_transactions, dates, frequency }
              monthly_investment [ month, investment_amount ]
transfers:    total_transfers { period { start, end }, total_transfer_amount }
              total_received { period { start, end }, total_received }
              by_recipient_count [ recipient, transaction_count, ranking ]
              monthly_transfer_amounts [ month, transfer_amount ]
              largest_transfers [ recipient, amount, date, ranking ]
fees:         total_fees { period { start, end }, total_fees }
              mpesa_fees { period { start, end }, fee_amount }
              transfer_charges { period { start, end }, transfer_charge_amount }
```

The six sections appear in this order. Square brackets are lists of records; braces are single records.

**How values become JSON:**
- **Times** become `YYYY-MM-DD hh:mm:ss`, and **dates** become `YYYY-MM-DD`.
- **Tables** become lists of records.
- **Every period in the report is dates only**, fees included: the fee comparison itself uses full times.
- **A missing time** among the values stops the whole report with an error (**A-4**, fixed below).

## Each analysis

### Cash flow
- **Total inflow:** paid in summed over rows whose direction is inflow.
- **Total outflow:** paid out summed over rows whose direction is outflow.
- **Net:** inflow minus outflow.
- **Closing balance:** the balance of the last row after sorting by completion time; 0.0 with no rows.

Every row counts, whatever its event type. Without pyarrow, the direction comparison read the old enum members wrongly, and inflow, outflow and net came out as 0.0 (**D-01**, fixed below).

### Spending
Qualifying spending is `MERCHANT_PAYMENT`, `BILL_PAYMENT` and `BUNDLE_PURCHASE`, measured by total cost, so attributed fees are included.

- **Monthly expenditure:** qualifying total cost summed by month. The month is read in exactly the `YYYY-MM-DD hh:mm:ss` form; an unreadable time falls in the month `Unknown`.
- **Top recipients:** qualifying total cost by identified entity, sorted largest first, ranked 1, 2, 3 in that order, and cut to the top 5.
- **Largest purchases:** individual qualifying rows with an identified entity, sorted by total cost largest first, cut to the top 10, and ranked 1 to 10.
- **Spending by entity:** qualifying total cost by identified entity. Ordered by each entity's most recent qualifying row, newest first.
- **Merchant usage frequency:** merchant payments counted by identified entity, most first. Ties stay in alphabetical order, and the ranks run 1, 2, 3.
- **Recurring purchases:** qualifying rows with an identified entity, grouped by merchant (rules under "Recurrence"). Ordered by each merchant's most recent row, newest first. Each also carries its median interval.

### Bills
`BILL_PAYMENT` rows only. Unidentified entities are **not** dropped here.

- **Recurring bills:** in-period payments, grouped by entity (rules under "Recurrence"). Ordered by each bill's most recent payment, newest first.
- **Bill spending:** in-period amounts summed by entity, in first-seen order, each with the period.

The amount is the total cost.

### Investments
`INVESTMENT` rows only, measured by paid out, not total cost.

- **Total investment:** the in-period sum.
- **By platform:** in-period sums by entity, in first-seen order.
- **Frequency:** the in-period count, given twice, and the sorted dates.
- **Monthly investment:** sums by month, in date order, over all investments: no period filter.

### Transfers
Money sent is `TRANSFER_OUT` measured by paid out, which leaves out the fee. Money received is `TRANSFER_IN` measured by paid in. Unidentified entities are **not** dropped.

- **Totals:** sent and received, each within the period.
- **Recipients by count:** most first. Equal counts share a rank, and the next rank skips.
- **Monthly amounts:** sums by month, in date order.
- **Largest transfers:** every transfer individually, largest first. Equal amounts share a rank.

### Fees
`FEE` rows within the period, compared at full time, measured by paid out. The fee's total cost is not used, because attribution zeroed it.

- **Total fees:** every fee.
- **M-PESA fees:** details equal, ignoring case, to one of the two known fee texts: customer transfer of funds charge, or pay bill charge.
- **Transfer charges:** details equal, ignoring case, to the transfer charge text alone.

### Recurrence
- **Which entities qualify:** an entity needs at least 3 payments.
- **The rule:** each gap between consecutive payments, in days and after sorting by date, must lie within 3 days of the median gap. For an even number of gaps, the median is the two middle gaps averaged and rounded down.
- **What is reported:** the occurrences, dates, gaps and amounts.

## How UNCLASSIFIED rows flow through

| Analysis | Unclassified rows |
|---|---|
| Cash flow: inflow, outflow, net | **Included**, by their direction |
| Closing balance | **Included** |
| Spending, all six figures | Excluded: not qualifying spending |
| Bills | Excluded |
| Investments | Excluded |
| Transfers | Excluded |
| Fees | Excluded, even when the text looks like a charge |

So unclassified money reaches the report only through cash flow and the closing balance. The share of unclassified rows, and their paid in and withdrawn totals, are reported in `quality`, not in the report.

## Where a figure depends on pandas' default sort order for ties

pandas' default sort is not stable, so the order of equal values is not promised.

1. **Closing balance:** rows are sorted by completion time with the default sort, then the last is taken. Two rows at the latest time can give either balance (**D-06**, deferred).
2. **Top recipients:** totals are sorted by amount with the default sort, then ranked in that order, so equal totals can swap ranks. Before sorting, grouping puts the entities in alphabetical order.
3. **Largest purchases:** rows are sorted by total cost with the default sort, so equal costs can swap places and ranks, and which rows make the top 10 can change at the cut.

**Deterministic, though they rest on ordering:**
- **Merchant usage frequency** uses an explicitly stable sort.
- **The recency orders** for spending by entity, recurring purchases and recurring bills use a stable sort or the language's own stable sort. Equal recency keeps the earlier order.
- **Transfer rankings** use the language's stable sort, and equal values keep the order the rows were met in.

## Deliberate changes in this port

| ID | Change |
|---|---|
| D-01 | Rows enter pandas once, with every class as plain text, so the direction comparison is right whether or not pyarrow is installed |
| A-4 | A missing time in the report becomes null instead of stopping the report |
| A-5 | No rows gives zero totals and empty lists instead of a missing-column error |

**Deferred, with the old behaviour kept** (they change figures, so they are decided with data):
- **D-06:** the tie order of the closing balance.
- **A-1:** comparing money at cents.
- **A-2:** each row's time read in its own format.
- **A-3:** rows with an unreadable date dropped by period filters.
