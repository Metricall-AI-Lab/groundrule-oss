---
"@groundrule/packs": patch
---

Catalog examples that the rule's own check catches. Nine rules (DOCKER-002, GHA-001, GO-009, K8S-001, K8S-002, K8S-007, K8S-012, SEC-015, TF-006) had examples too short for their check to act on: a Kubernetes line with no `kind:`, a usage line without its import, a sentence instead of code, an example in a language the check doesn't read. Each now shows enough of the file to be caught, so the dashboard can show the rule working on it. No check changed.
