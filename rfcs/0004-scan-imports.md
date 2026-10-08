# RFC 0004: Imports in scan reports

- **Status:** Accepted
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add an optional `imports` section to `ScanReport` (RFC 0003): instructions found in agent files, linter and compiler settings that correspond to catalog rules, and CODEOWNERS entries. They become proposals an organization reviews (accept, edit, reject) instead of writing rules from scratch. Everything is extracted deterministically; nothing is AI.

## Motivation
Teams already wrote their standards down, in AGENTS.md, CLAUDE.md, Cursor and Copilot instructions, and already enforce some of them with ESLint, Ruff, or tsconfig. CODEOWNERS already says who owns infrastructure, CI, or security code. Importing this makes adoption start from the team's own words and tools.

## Proposal
```yaml
imports:
  instructions:            # one per list item or directive paragraph, de-duplicated across files
    - text: Never log request bodies, tokens, or personal data.
      section: Rules › Security          # heading path (the document title is left out)
      strength: must                     # must | should | info, from the wording
      scope: { paths: ["src/**/*.ts"] }  # from Cursor `globs` or Copilot `applyTo`
      sources: [{ file: AGENTS.md, startLine: 14, endLine: 14 }, { file: CLAUDE.md, startLine: 3 }]
      similar: [{ id: SEC-006, score: 0.62 }]   # keyword match against the catalog
      fingerprint: <sha256 of the normalized text>
  toolSettings:
    - { tool: eslint, setting: no-console, value: error, stance: enforced, standardId: TS-001, source: { file: eslint.config.mjs, line: 12 } }
    - { tool: ruff, setting: E722, value: ignored, stance: disabled, standardId: PY-001, source: { file: pyproject.toml, line: 30 } }
  owners:
    - { pattern: /.github/workflows/, owners: ["@acme/devex"], category: ci, repositoryDefault: false, source: { file: .github/CODEOWNERS, startLine: 3 } }
```
- Instruction text is redacted like snippets and leaves the machine only with `--upload`; `--no-import` omits the section.
- Configuration files are read as text and never executed (ESLint flat configs are JavaScript).
- Supported: ESLint (flat and legacy), Biome, Ruff (pyproject.toml, ruff.toml; prefix selection and ignores), golangci-lint, Checkstyle, PMD, and tsconfig. The mapping table lives with the catalog (`@groundrule/packs`).
- Limits: 500 instructions, 300 tool settings, 200 owner entries.

## Compatibility
Additive and optional; reports without `imports` stay valid.

## Alternatives considered
- AI extraction: better at prose, but it belongs behind the LLM gateway with redaction, budgets, and evals (Phase C). This deterministic split is the baseline the AI version will be measured against.
