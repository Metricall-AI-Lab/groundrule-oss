---
"@groundrule/packs": minor
---

Two catalog rules corrected.

- **SEC-015** (string-built SQL) now reads Java files. Until now Java was left to JAVA-007 in the Java and Spring pack, so a project using only the security baseline was not checked. A Java project may see new SEC-015 findings. JAVA-007 leaves the essentials set, so a new project gets one finding per line, not two; it stays in the Java and Spring pack, where it also catches SQL fragments.
- **ARCH-004** (UI components never import data access) no longer reports a database client imported by code that isn't UI. That check ran on every file; it is now limited to `components`, `ui` and `views`, as the rule says. ARCH-008 remains the rule for database clients outside the data layer.
