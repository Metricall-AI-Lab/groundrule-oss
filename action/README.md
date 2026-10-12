# Groundrule GitHub Action

Checks every pull request against your engineering standards, posts a summary, and optionally uploads findings to GitHub code scanning so they appear inline on the diff. With a `token`, it also sends each result to your organization on Groundrule, where the **Pull requests** page shows every run across repositories.

```yaml
name: Groundrule
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write   # for code scanning upload

jobs:
  groundrule:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0     # needed to compare against the base branch
      - uses: Metricall-AI-Lab/groundrule-oss/action@main
        with:
          token: ${{ secrets.GROUNDRULE_TOKEN }}   # optional: send results to Groundrule
```

Pin the action to a commit SHA (`@<sha>`) for reproducible builds. Create the token in Groundrule under **Settings → API tokens** with **Upload scans and check results**, and save it as the repository secret `GROUNDRULE_TOKEN`.

| Input | Default | Description |
|-------|---------|-------------|
| `version` | `latest` | CLI version |
| `base` | PR base / previous commit | Ref to compare against |
| `fail-on` | from config | `blocker`, `warning`, or `none` |
| `sarif` | `true` | Upload to code scanning |
| `check-sync` | `true` | Fail if agent instructions are stale |
| `working-directory` | `.` | Repository location |
| `token` | none | Groundrule API token; when set, results are uploaded with the pull request they were for |
| `snippets` | `true` | With `token`: `false` sends no code snippets |
| `url` | `https://app.groundrule.dev` | Groundrule platform address |

Exit codes: `0` passed, `1` failed, `2` configuration error. A failed upload never changes the exit code: the check's own result stands.
