# Naming

The public name and domain are the owner's decision. This file records it.

Chosen name: (pending: the owner decides)
Domain: (pending: the owner decides)

## The rule

- The public name and the domain avoid the M-Pesa trademark: no "M-Pesa", "MPESA", "M Pesa" or
  similar, in any case or spacing. "M-PESA" may still appear where the app describes what it
  reads ("Read an M-PESA statement"), never as the app's own name.
- The README and the app's footer say the app is not affiliated with Safaricom.
- The name the app shows (the web manifest's `name` and `short_name`, the page title in
  `web/src/app/layout.tsx`) is the chosen name.

`tools/release/check_naming.py` checks all three and runs in the release workflow before
anything is deployed, so a version tag cannot deploy until the name is chosen.

## Names in use today

| Where | Name |
|---|---|
| Repository, package names | mpesa-analytics, mpesa-core |
| Web manifest, page title, mobile header | M-Pesa Analytics |
| Desktop footer | Sovereign Ledger |

The repository and package names are not public-facing. The manifest and title must change to the
chosen name before release.
