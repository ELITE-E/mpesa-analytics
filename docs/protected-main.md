# Protected main: settings to apply

For you to apply once a remote exists; nothing here is configured by this repo. The local
branch is currently `master`, while CI triggers on pushes to `main`, so rename it first:
`git branch -m main`.

In Settings, Branches, add a rule (or ruleset) for `main`:

- Require a pull request before merging, with at least 1 approval
- Dismiss stale approvals when new commits are pushed
- Require status checks to pass: `guards`
- Require branches to be up to date before merging
- Require conversation resolution
- Require linear history
- Block force pushes and deletions
- Do not allow bypassing the rules, including for administrators

In Settings, Actions, General:

- Workflow permissions: read repository contents only
- Do not allow Actions to create or approve pull requests
- Allow only actions pinned to a full commit SHA, if available on your plan
- Require approval to run workflows from all outside contributors
- Artifact retention: 1 day (`ci.yml` already sets this for the wheel)

In Settings, Code security: enable secret scanning and push protection, and private
vulnerability reporting. Define no repository secrets: CI needs none.
