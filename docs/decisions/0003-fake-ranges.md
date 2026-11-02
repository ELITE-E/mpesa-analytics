# 0003: Fake phone ranges for fixtures

Status: proposed, allocation **not confirmed**.

## Ranges

Written as prefix plus digit count, because the literal forms would trip guard 1 outside
`fixtures/synthetic/`.

- International: prefix `254700000` plus 3 digits (1000 numbers)
- Local: prefix `07000000` plus 2 digits (100 numbers)

The local range is a subset of the same numbers as the international one. The local form of
the full international range would be prefix `0700000` plus 3 digits, so if fixtures need
all 1000 numbers in local form the local range must be widened.

## Are they unallocated?

**Unsure, and there is reason to doubt it.** A secondary source lists 0700-0709 as a Safaricom
prefix block ([sent.dm](https://sent.dm/resources/KE)), so these numbers probably sit inside an
allocated block. Whether these specific subscriber numbers are assigned to anyone is unknown.
No range reserved for fictitious use in Kenya was found.

The authoritative source was not read, because CP0 rules forbid opening a real PDF: the
[Communications Authority numbering plan, April 2026](https://www.ca.go.ke/sites/default/files/2026-04/Numbering%20Plan%20Kenya%20April%202026.pdf).

## Consequence

Treat these as "fake by our declaration", not "cannot belong to anyone". Never dial or message
them, and never send them to any external service. To settle it, check the plan above for a
reserved or test range; if there is one, change `fake_ranges` in `tools/guards/guards.toml`.

## Not declared, needed for CP1

- **Receipts.** No fake receipt range is declared, so any receipt-like token fails guard 1 even
  inside `fixtures/synthetic/`.
- **Masked phones.** Masked forms also fail there, because a masked token cannot be proven to
  fall inside a fake range.

CP1 fixtures will need a decision on both.
