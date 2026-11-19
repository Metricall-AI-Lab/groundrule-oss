---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/cli": minor
---

A shorter config file (RFC 0018). `.groundrule/config.yaml` may leave out `apiVersion` and `kind`, and `groundrule init` and `groundrule start` now write the common case in a few lines: the packs, the agent files, and a pointer to the other settings. Existing config files read exactly as before. A config written without the header needs this release or later wherever it is read.
