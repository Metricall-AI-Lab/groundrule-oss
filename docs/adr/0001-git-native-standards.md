# ADR 0001: Standards live in git as YAML

- **Status:** Accepted
- **Date:** 2026-10-07

## Context
Standards need versioning, review, approval, history, and "which version applied when this merged?" Building that into a SaaS registry is a large surface, and engineers already trust git for exactly these jobs.

## Decision
Standards, packs, repository config, and file-based exceptions are YAML files in git. An organization keeps shared packs in a standards repository; each repository has a `.groundrule/` directory. The cloud product syncs from git; it does not replace it as the source of truth.

## Consequences
- Versioning, review (PRs), approvals (CODEOWNERS), and history come for free.
- Works fully offline and without the cloud.
- The cloud must handle sync, caching, and pinning (`@ref`) of remote packs.
- Non-engineers author standards through a UI that writes PRs, not direct database edits.
