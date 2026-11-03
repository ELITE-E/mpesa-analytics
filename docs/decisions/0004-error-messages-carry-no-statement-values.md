# 0004. Error messages carry no statement values

Status: Proposed (becomes Accepted when the enforcement test below passes)
Date: 2026-11-02

## Context

The standards ask for error messages that say what failed, where, and which operation was affected (5.6). A statement contains names, phone numbers, amounts and receipt numbers. Exception messages end up in browser consoles, bug reports and screenshots. The old code logged raw values (`utils.py` logged the unparsed value), which is the kind of leak this repository exists to remove.

## Decision

Exception messages, log lines and console output carry **codes, positions and counts only**:

- Allowed: error code, page number, row index, column name, expected and found counts, the engine name and version.
- Never allowed: details text, names, phone numbers, amounts, balances, receipt numbers, dates taken from a row, any slice of statement text.

`Diagnostic` objects may hold row details **in memory** so the user's own screen can show which row has a problem. They are never written to an exception message, the console, a network request or storage.

Exceptions convert at the bridge into `{code, row_index?}`. No traceback with local variables crosses the bridge.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Redact values in messages with a regex | Misses formats nobody anticipated; a pattern cannot know a name |
| Allow values in messages for local debugging | One forgotten message becomes a leak in a screenshot |
| Positions and counts only (chosen) | Less convenient when debugging; the row index lets the owner look at the row on their own screen |

## Consequences

- Messages are slightly less descriptive; the row index and column name replace the value.
- Error constructors take a code and integers, never free text from a row.
- The old `utils.py` log of the raw value is not carried over (behaviour-changes D-04).

## Enforcement

- Exception classes accept only an error code and integer positions; a test asserts that passing a string value raises `TypeError`.
- A test raises each core error with a planted fake row value and asserts the value is absent from `str(error)`.
- Tests pass a failure's message and its planted row to `assert_message_is_safe` in `tools/guards/error_message_safety.py`, which rejects any repeated row value or phone-shaped or receipt-shaped token. It only covers failure paths a test triggers, catches repeats rather than derived values, and skips values under 3 characters.
- The no-leak end-to-end test (CP9) asserts no statement text reaches the console or the network.
- Review checklist item 4: "Error messages are meaningful and carry no statement values."
