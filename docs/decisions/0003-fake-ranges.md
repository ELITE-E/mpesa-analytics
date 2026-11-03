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

## Declared for CP1

Owner decision at CP1. All are honoured inside `fixtures/synthetic/` only, and written here by pattern, because the literal forms would trip guard 1 elsewhere.

- **Receipts:** `ZZ` plus 8 uppercase characters or digits.
- **Masked phones:** `2547`, then 5 asterisks, then a tail from 000 to 099. The local masked form is not declared.
- **Merchants:** `Example Till` plus 3 digits. Guard 1 does not check names, so the generator's tests do.

Real receipts could in principle start with `ZZ`. As with the phone ranges, these are fake by our declaration.

## PDF cross-reference offsets

Every PDF's cross-reference table holds 10-digit byte offsets, which match the receipt rule. Inside `fixtures/synthetic/*.pdf` only, an offset of three zeros and seven digits, followed by a 5-digit generation and `n` or `f`, is skipped. Three leading zeros mean it can never cover a phone number or a receipt. Fixture PDFs are uncompressed so guard 1 can still read the text inside them. F-ENCRYPTED's text is encrypted, so guard 1 cannot read it; its items and expected files carry the same kind of values and are scanned.
