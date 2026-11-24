# Release checklist

For version 1.0.0 and every release after it. Part 1 needs no real data and runs in CI on every
pull request; run it locally too before tagging. Part 2 is the owner's, on the owner's machine,
with a real statement; nothing from it is committed, and only counts and PASS/FAIL lines are
ever pasted anywhere.

Tick every box, then tag. Only the tag deploys (`.github/workflows/release.yml`); nobody deploys
by hand.

## Part 1: automated gates

From the repo root, with the runtime fetched (`uv run python tools/vendor.py fetch`):

- [ ] `uv run pre-commit run --all-files`: guards, lint and format pass.
- [ ] `uv run pytest`: core, guard, tool and release-document tests pass.
- [ ] `node --test tests/pdf_readers/*.test.js`
- [ ] `uv build --wheel --out-dir dist && uv run python tools/vendor.py runtime --wheel dist/mpesa_core-1.0.0-py3-none-any.whl`
- [ ] `node tools/run_pyodide_tests.mjs`: the core under Pyodide.
- [ ] `uv run python tools/guards/check_wheel.py dist/mpesa_core-1.0.0-py3-none-any.whl`
- [ ] `npm run build --prefix web`
- [ ] `node tools/measure_app_download.mjs > /tmp/fetched.json && uv run python tools/measure_bundle.py --app web/out --fetched /tmp/fetched.json`: within the bundle budget.
- [ ] `node --test --test-concurrency=1 tests/browser/*.test.js`: the engine in Chrome.
- [ ] From `web/`: `node --import ./tests/support/register.mjs --test tests/*.test.mjs tests/*.test.ts`: the web app, Chrome tests included.
- [ ] From `web/`: `node --import ./tests/support/register.mjs --test tests/host-headers.test.mjs`: the headers for both hosts, every route.
- [ ] `node --test --test-concurrency=1 tests/release/*.test.mjs`: check_deployed against a loopback host, and the checksums.
- [ ] `uv run python tools/release/scan_history.py`: PASS; every commit on every ref is clean.
- [ ] `uv run python tools/release/third_party_notices.py --check`: the notices match the lockfiles.
- [ ] `uv run python tools/release/check_naming.py`: PASS. It fails until the name is chosen (Part 2).
- [ ] CI is green on the commit to be tagged.

## Part 2: manual gates (owner, real data)

Use the paths from your own notes. Every output folder below holds real data and is deleted at
the end of this part. Each folder must not exist before its command runs.

**Equivalence with the old app**

- [ ] Baseline export, with the old repo's Python:
      `<old repo>/.venv/bin/python tools/equivalence/export_baseline.py --old-repo <old repo> --pdf <statement> --out <check folder>`
- [ ] Compare: `uv run python tools/equivalence/compare.py --pdf <statement> --baseline <check folder>/baseline.json --share`: every gate PASS.
- [ ] Browser engine: `node tools/equivalence/browser_run.mjs --pdf <statement> --out <browser folder>`, then
      `uv run python tools/equivalence/compare.py --browser-result <browser folder> --pdf <statement> --baseline <check folder>/baseline.json --share`: every gate PASS.
- [ ] The real UI: `node tools/equivalence/ui_run.mjs --pdf <statement>`: PASS.
- [ ] The real UI with remembering: `node tools/equivalence/ui_run.mjs --pdf <statement> --remember`: PASS.
- [ ] Signature probe: `node tools/probes/pdf_signature_probe.mjs <statement>`: note the answers.

**Clean up the private output**

- [ ] `rm -rf <check folder> <browser folder>`, and any other folder a command above wrote.
- [ ] Empty the browser profile or downloads of anything the runs left (CSV exports included).

**Name, host and legal**

- [ ] Choose the public name and domain, free of the M-Pesa trademark; record them in
      `docs/NAMING.md`, and set the web manifest's `name` and `short_name` and the page title to
      the name. `uv run python tools/release/check_naming.py` then passes.
- [ ] Choose the licence (`LICENSE.pending` says what the choice involves).
- [ ] Legal review, OQ-17: the Kenya Data Protection Act and invite-only, local-only distribution.
      Record the outcome in `docs/decisions/`.
- [ ] Choose the host. In the repo's settings, set the variable `DEPLOY_HOST` (`cloudflare-pages`
      or `netlify`) and, for Cloudflare Pages, `CLOUDFLARE_PROJECT`, `WRANGLER_VERSION` and the
      secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; for Netlify,
      `NETLIFY_CLI_VERSION` and the secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`. Pin each
      CLI version to an exact release. Give the `production` environment a required reviewer.
- [ ] Turn off the host's analytics, beacons, email obfuscation and any script injection;
      `check_deployed` fails if any is left on.

**Exposure cleanup**: the old app's exposure list (from the migration notes, `CONTAMINATION_REPORT.md`, "Things outside the repo")

- [ ] Old repo stays private; list forks and who has or had access; remove outside collaborators.
- [ ] Old repo's Actions: delete run logs, artifacts and caches; delete the secret holding the
      statement password and treat that password as exposed.
- [ ] Check the Copilot and agent branches' sessions and logs; ask GitHub Support about cached PR
      views if needed.
- [ ] Render, Vercel and Neon: logs, preview deployments, env vars, backups and point-in-time
      history; rotate credentials, then delete the services.
- [ ] Friend or family data in those systems: decide on deletion and tell them.
- [ ] Local machine: old clones and worktrees, the old database and journal, evidence folders,
      diagnostics files, dumps, env files, coverage files, old scratchpads, downloaded CSVs, the
      old app's browser storage, and the private paths list once used.
- [ ] Assistant transcripts and memory from the old project, and any other chat where statement
      data was pasted; delete them and turn off training where offered.
- [ ] Design-tool exports that hold receipt-like values; their source projects too.

**Tag and check**

- [ ] Move the CHANGELOG entry from "unreleased" to today's date.
- [ ] `git tag -s v1.0.0 && git push origin v1.0.0`. The release workflow runs CI, deploys and
      drafts the GitHub release with its checksum and `sha256sums.txt`.
- [ ] Download `sha256sums.txt` from the draft release; `sha256sum sha256sums.txt` equals the
      release checksum in its notes.
- [ ] `node tools/release/check_deployed.mjs <site URL> --sums sha256sums.txt`: every line PASS.
- [ ] Publish the draft release.
