---
"@groundrule/cli": patch
---

The GitHub Action uses `actions/setup-node@v7` and `github/codeql-action/upload-sarif@v4`, which run on Node.js 24, so workflows no longer show GitHub's Node.js 20 deprecation notice.
