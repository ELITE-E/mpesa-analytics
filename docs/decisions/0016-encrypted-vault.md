# 0016. "Remember on this device" is an encrypted vault: WebCrypto, whole-ledger blobs, off by default

Status: Accepted (owner instruction, CP9a)
Date: 2026-11-18

## Context

ADR 0012 keeps "Remember on this device" in v1: opt-in, saving and merging. The migration plan's decision D4 had recommended storing the rows and report in plain IndexedDB, and listed passphrase encryption (option C) as the alternative: real protection at rest against casual access to the device, at the cost of passphrase handling, no recovery, and no protection against malicious script. The owner chose option C for CP9a. Statement rows hold counterparties' names and masked numbers, and family phones are often shared, so a remembered ledger must be unreadable to anyone who opens the browser profile without the passphrase.

The architecture's section 6 (IndexedDB) described five stores (`statements`, `transactions`, `links`, `snapshots`, `observations`) written in one transaction per import. With encryption, those records are no longer separate rows the database can see.

What a plain-words account of what the lock protects, and what it does not, is in `docs/THREAT_MODEL.md`.

## Decision

The vault lives in `web/src/persistence/` and uses the browser's WebCrypto only; no crypto library.

- **Key.** PBKDF2 with SHA-256, at least 600,000 iterations, over a random 16-byte salt, derives a non-extractable AES-GCM 256-bit key. The key exists only in the vault object's memory while unlocked; it is never stored, and neither is the passphrase.
- **Blobs.** Every save encrypts the whole ledger as JSON with a fresh random 12-byte IV. The associated data binds each blob to its slot (`key_check` or `ledger:<id>`), the schema version and its version counter, so a blob moved to another slot, given another counter or read under another schema fails authentication.
- **Database.** One IndexedDB database, `mpesa-analytics-vault`, with two stores:
  - `meta`: one plaintext record: `schema_version`, the KDF parameters (`PBKDF2`, `SHA-256`, iterations), the salt, a key check (a known text sealed under the key, so a wrong passphrase is told apart without touching a ledger), the optional hint, and `remember_on_device: true`.
  - `ledgers`: one record per ledger id: the IV, the ciphertext, the version counter and the schema version.
  - One IndexedDB transaction per save. The five record kinds of section 6 become fields inside one ledger blob; their rules (CP9 behaviours S-01 onward) are CP9b's.
- **Off by default.** Until the person opts in (`create`), nothing is written: not even the database is created. `saveLedger` with remember off returns `{ saved: false, reason: "REMEMBER_OFF" }`. Persistent storage (`navigator.storage.persist()`) is requested only at opt-in.
- **Passphrase and hint.** At least four words of three or more characters, or at least 16 characters; one short pattern repeated, or fewer than five different characters, is a trivial repeat and refused. The hint is optional, at most 60 characters, refused if it contains any word of the passphrase (and so the passphrase itself), and returned only after a failed unlock.
- **Lock.** `lock` drops the key and every ledger the vault holds and tells listeners (`onLock`) to clear the screen. The vault locks itself after an idle time (10 minutes by default, injectable timers), restarted by `noteActivity`. It also locks when another tab deletes or upgrades the database (it closes its connection then, so the other tab is not blocked).
- **Failures.** One error type, `VaultError`, with a code and a fixed plain message, never a value (ADR 0004):
  - wrong passphrase: `WRONG_PASSPHRASE`, nothing written, still locked;
  - changed, truncated or moved blob: `LEDGER_DAMAGED`, nothing from it returned or held;
  - newer `schema_version` in meta or a ledger record, or a database laid out by a newer app: `SCHEMA_TOO_NEW`, refused, never guessed;
  - stored KDF parameters other than PBKDF2-SHA256, or fewer iterations than the vault's own: `KDF_PARAMETERS_REFUSED`, before any key is derived;
  - storage unavailable or blocked: memory-only mode with `STORAGE_UNAVAILABLE`;
  - quota exceeded: `STORAGE_QUOTA_EXCEEDED` and memory-only mode; any other failed write: `STORAGE_WRITE_FAILED`; in both the transaction aborts and the previous blob stays intact;
  - a stale tab: `STALE_LEDGER` (compare-and-set on the version counter, read and written in one transaction), told to reload.
- **Never stored.** Before encrypting, `findForbiddenContent` refuses a ledger holding PDF bytes or any binary value, a field named for the PDF password, the verification token, the account digest, the mobile number, the customer's name or an email address, or an email address in any text (`FORBIDDEN_CONTENT`, with `detail` naming the kind from a fixed list). It refuses rather than strips, so a careless ledger builder fails loudly in tests.
- **Iterations in tests.** `openVault` is the app's factory and always uses `PRODUCTION_KDF_ITERATIONS` (600,000); any option passed to it is ignored. `openVaultWithIterations(count)` is the named factory unit tests use for speed. A vault refuses stored parameters below its own count, so a lowered count in storage is never followed. A guard test proves no app source calls the test factory.
- **Delete-all.** Deletes the whole database (every ledger, the salt, the hint and the settings). It works while locked, for a person who forgot the passphrase. Turning remember off is the same operation; the confirmation dialogs (N-15, N-16) are CP9b's.

### Dependencies

No runtime dependency. `fake-indexeddb` 6.2.7 is a dev dependency of `web/` for unit tests (it replaces the browser's IndexedDB, the one external dependency mocked; standards 9.5). The real-Chrome tests use the system Chrome through `playwright-core`, already a dev dependency.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Plain IndexedDB (D4 option A) | Simplest; anyone with the unlocked browser profile reads every row |
| One record per transaction, each encrypted | Finer writes and smaller saves, but record counts, sizes and update patterns leak, and a cross-record transaction must keep many blobs consistent |
| Whole-ledger blobs (chosen) | One write per save, all or nothing; nothing but sizes and counters leaks. A large ledger rewrites in full each save; a measured problem would be met by splitting ledgers, not records |
| A crypto library (libsodium, argon2) | Memory-hard KDF is stronger against guessing, but adds a dependency and a wasm download to the budget; WebCrypto has no Argon2 |
| Strip forbidden fields silently | Saves always succeed, but hides a caller's mistake and may drop data the person expects |

## Consequences

- No recovery: a forgotten passphrase means delete-all and reading the statements again. The hint is the only help, and it is plaintext.
- Unlock costs one 600,000-iteration derivation: about 1 second in Node 24 on the development workstation (the guard test's `create`); not yet timed on its own in Chrome, and phones are slower. Measure on a phone at CP10.
- The owner's D4 recommendation (plaintext) is superseded by this ADR.
- Chrome 152 facts found while testing: a quota error arrives as a transaction abort with `QuotaExceededError` (with `Storage.overrideQuotaForOrigin` set, even though `navigator.storage.estimate()` still reports the default quota); with all site data blocked, `indexedDB.databases()` and `open()` fail with `UnknownError`.
- Found while testing: an unbounded email pattern over a long unbroken text backtracked quadratically and froze the page (40,000 characters took 10.7 seconds); the check now looks only around each "@".

## Enforcement

- `web/tests/vault-policy.test.mjs`: the passphrase and hint rules.
- `web/tests/vault-lock.test.mjs`: create, unlock, lock, idle lock, delete-all, fresh IVs, nothing secret stored.
- `web/tests/vault-tamper.test.mjs`: changed, truncated and moved blobs; newer schema versions.
- `web/tests/vault-never-stored.test.mjs`: remember off writes nothing; persistent storage only on opt-in; every forbidden kind refused; raw and decrypted scans.
- `web/tests/vault-failures.test.mjs`: memory-only mode, quota, failed writes, stale tabs.
- `web/tests/vault-iterations.test.mjs`: the 600,000 floor and that nothing lowers it.
- `web/tests/vault-chrome.test.mjs`: real Chrome under the architecture CSP: zero requests and violations, quota, blocked storage, two tabs, delete-all across tabs, no service worker or cache.
