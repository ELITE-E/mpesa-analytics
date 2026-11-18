# Threat model: "Remember on this device"

What the lock on remembered data protects, and what it does not. For the design behind it, see ADR 0016 (`docs/decisions/0016-encrypted-vault.md`).

## In one paragraph

By default the app remembers nothing: a statement is read in your browser, shown, and forgotten when you close the page. If you turn on "Remember on this device", the app keeps your transactions in your browser's storage, locked with a passphrase you choose. Someone who picks up your phone or laptop later and opens the browser cannot read them without the passphrase. The lock does nothing while the app is open and unlocked, it does not cover PDF files or CSV exports you saved yourself, and it is only as strong as your passphrase.

## What the lock protects

- **Saved transactions on a device someone else uses.** Every saved ledger is encrypted (AES-GCM with a 256-bit key). Without the passphrase, the browser's storage holds only scrambled bytes, the protection settings (salt and iteration count) and your hint, if you set one.
- **Copies of the browser's files.** Someone who copies the browser profile, or reads it with developer tools, gets the same scrambled bytes. Guessing the passphrase is slowed down on purpose: each guess costs 600,000 rounds of PBKDF2-SHA256.
- **Changes made outside the app.** If saved data is changed, cut short or moved, the app notices, says so, and shows nothing from it. It never shows part of a damaged ledger.
- **Statements from different accounts.** Each account's statements go into their own locked ledger and are never compared with another account's. A statement whose account cannot be read is kept only if you choose the ledger it belongs to.
- **Things that are never saved at all.** The PDF itself, its password, the statement's verification code, the account digest, your mobile number, your name and your email address are never written to storage, locked or not. The app refuses to save anything that carries them.

## What the lock does not protect

- **An unlocked, open session.** While the app is unlocked, your transactions are on the screen and in the page's memory. Anyone at the device can see them. The app locks itself after 10 idle minutes, and you can lock it by hand; until then, it is open.
- **PDF statements and CSV exports you saved yourself.** Your downloaded M-PESA PDF, and any CSV you export from the app, are ordinary files in your downloads folder. The app does not lock them, track them or delete them. Delete them yourself when you are done.
- **A weak passphrase.** The app refuses short passphrases (fewer than four words and fewer than 16 characters) and trivial repeats, but it cannot tell a guessable passphrase ("password password password password" is refused; a famous quotation is not). Use words that are not about you and not a known phrase.
- **Your hint.** The hint is stored as plain text, so that it can be shown when you forget. It must not contain any word of your passphrase, and it is shown only after a failed unlock, but anyone with the device can read it from storage. Leave it empty if you do not need it.
- **Malicious software on the device, or a malicious browser extension.** Something that can read the page while it is unlocked, or record what you type, can read your transactions or your passphrase. The lock cannot help against that.
- **Forgetting the passphrase.** There is no recovery. If you forget it, delete the saved data (this works while locked) and read your statements again.
- **The browser clearing storage.** A browser may clear site data (for example when space runs low, or when you clear browsing data). The app asks the browser to keep the data when you turn remembering on, but browsers may still remove it. Keep your PDF statements if you need them.

## What leaks even when locked

- That this device remembers M-PESA data, and roughly how much (the size of each saved ledger).
- How many different accounts are remembered: one ledger each. Which account a ledger belongs to is hidden: its name is a keyed hash of the account that cannot be worked out without the passphrase (ADR 0017).
- How many times each ledger has been saved (its version counter).
- The hint, if you set one.

## Failure behaviour you can rely on

- A wrong passphrase unlocks nothing, changes nothing and says only that the passphrase did not work.
- If saving fails (for example, the device is out of space), what was saved before stays as it was, and the app keeps working without saving.
- If another tab saved newer data, this tab is told to reload; it never overwrites the newer data.
- If the browser does not allow storage (for example some private windows, or storage disabled), the app still works and says nothing will be kept.
- "Delete all saved data" removes everything the app stored on this device: every ledger, the salt, the hint and the settings.
- Unlocking, saving and deleting make no network requests: nothing about your data leaves the device.
