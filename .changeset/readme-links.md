---
"@groundrule/cli": patch
"@groundrule/packs": patch
---

Fix links in the package READMEs on npm: they pointed to files relative to the repository, which don't exist on npmjs.com. They now link to the CLI docs and to the repository on GitHub.
