---
"@groundrule/core": minor
"@groundrule/cli": minor
---

`groundrule check` can run fully offline from input files (for Groundrule's hosted checks): hidden `--offline`, `--rulebook`, `--changes`, `--pull-request`, `--commit` and `--write-check-run` options. Offline, packs from GitHub are refused instead of fetched and local sources must stay inside the repository; the result is the same as the same check in CI.
