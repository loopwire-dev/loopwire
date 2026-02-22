# GitHub Configuration

Repository automation and governance.

## Workflows

- `ci.yml`: lint/typecheck/test checks, coverage generation, and coverage upload to Qlty.
- `ship.yml`: manually triggered shipping flow (detect changes, deploy web, tag/release daemon).
- `labeler.yml`: automatic PR labels from changed paths.
- `sync-labels.yml`: sync label catalog from `.github/labels.json`.

## Templates and labels

- Issue forms: `.github/ISSUE_TEMPLATE/`
- PR template: `.github/pull_request_template.md`
- Label config: `.github/labels.json`, `.github/labeler.yml`
- Hook config: `.pre-commit-config.yaml` (run with `prek`)
