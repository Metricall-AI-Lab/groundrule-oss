# Groundrule GitHub Action

Checks every pull request against your engineering standards, posts a summary, and (optionally) uploads findings to GitHub code scanning so they appear inline on the diff.

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
      - uses: groundrule/groundrule/action@v0
```

| Input | Default | Description |
|-------|---------|-------------|
| `version` | `latest` | CLI version |
| `base` | PR base / previous commit | Ref to compare against |
| `fail-on` | from config | `blocker`, `warning`, or `none` |
| `sarif` | `true` | Upload to code scanning |
| `check-sync` | `true` | Fail if agent instructions are stale |
| `working-directory` | `.` | Repository location |

Exit codes: `0` passed, `1` failed, `2` configuration error.
