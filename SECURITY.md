# Security

This repo must never hold real statements, phone numbers, receipts or passwords. Every
fixture is synthetic and regenerates from a seed in `tests/fixtures/synthetic/MANIFEST.toml`.
The app reads statements in the browser only; what it stores, and what the lock protects, is in
`docs/THREAT_MODEL.md`.

## Reporting a vulnerability

Report privately. On GitHub, open the repo's **Security** tab and choose **Report a
vulnerability** (a private security advisory, seen only by the owner). If that is not
available to you, contact the repo owner directly and ask for a private channel. Do not open a
public issue for a vulnerability.

Include:

- what an attacker could do, and the steps to reproduce it with the synthetic fixtures or a
  statement you made up;
- the file path and line, or the page and action, where it happens;
- the browser and its version.

**Never attach a statement**, real or redacted, and never paste its text, a screenshot of it,
receipt numbers, phone numbers, names or amounts. Redaction misses things; a description of the
shape is enough ("a row whose details wrap onto three lines").

## Real-looking data found in this repo

Report it the same way, privately. Give the file path, the commit if you know it, and a count
("3 phone-shaped numbers"). Do not quote the data.

## What happens next

The owner acknowledges the report, confirms or rules out the problem, and fixes it in a private
branch before it is disclosed. Fixed issues are listed in `CHANGELOG.md` without the reporter's
data.
