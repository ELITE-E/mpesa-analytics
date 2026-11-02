# 0007. Replace PagesDocument with StatementPages

Status: Proposed
Date: 2026-11-02

## Context

`PagesDocument` is the contract name for the engine's output: the positioned text of all pages of one statement. Standard 1.3 says: "If the domain says statement, do not call the same thing a document, file or record." `PagesDocument` calls a statement a document, and reads as if a separate document type exists alongside the statement. The name is not used in any code yet.

## Decision

Name the type **`StatementPages`**. The standards already use `statement_pages` for this value (sections 2.3 and 3), so the type and the variable match. The glossary already lists it this way.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| `ExtractedStatement` | Suggests the result has been interpreted, when it is only positioned text |
| `StatementDocument` | Keeps the word the standards ask us to avoid |
| `PageSet` | Loses the domain word; a set implies no order, while pages are ordered |
| `StatementPages` (chosen) | Slightly longer; says exactly what it holds and is searchable |

## Consequences

Contracts written in CP1 use `StatementPages` from the start, so nothing has to be renamed.

## Enforcement

`PagesDocument` is not yet in `banned_names`, because this decision is still Proposed. On acceptance, add it to `banned_names` in `tools/guards/guards.toml` and to `BANNED_NAMES` in `eslint.config.mjs`.
