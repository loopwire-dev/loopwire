# GitHub Configuration

Repository automation and governance.

## Workflows

- `docs-coverage.yml`: checks README coverage for key project directories.
- `ci.yml`: lint/typecheck/test/build checks.
- `coverage.yml`: frontend and backend coverage generation + upload.
- `prek.yml`: repository hook checks from `.pre-commit-config.yaml`.
- `release.yml`: release artifacts.
- `deploy.yml`: frontend deployment.
- `pr-governance.yml`: PR template/body enforcement.
- `labeler.yml`: automatic PR labels from changed paths.
- `sync-labels.yml`: sync label catalog from `.github/labels.json`.

## Templates and labels

- Issue forms: `.github/ISSUE_TEMPLATE/`
- PR template: `.github/pull_request_template.md`
- Label config: `.github/labels.json`, `.github/labeler.yml`
- Hook config: `.pre-commit-config.yaml` (run with `prek`)
