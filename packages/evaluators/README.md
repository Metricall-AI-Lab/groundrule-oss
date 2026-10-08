# @groundrule/evaluators

Built-in checks. Every check in a standard names one by `evaluator:`; all other keys are its options.

| ID | Source | Options |
|----|--------|---------|
| `files` | deterministic | `require`, `requireAny`, `forbid`, `allow`, `message` |
| `regex` | deterministic | `pattern`, `flags` (i/s/u), `mode` (forbid/require), `include`, `exclude`, `message`, `maxMatchesPerFile` |
| `dependencies` | deterministic | `forbid` (names or globs), `ecosystems`, `allowInstead`, `message` |
| `change-set` | deterministic | `when: {changed, added}`, `require: {changed, added}`, `message` |
| `semgrep` | static analysis | `rules` (path relative to the standard file, or a registry config such as `p/owasp-top-ten`), `timeoutSeconds` |
| `llm` | AI | Placeholder until 0.2 |

Write your own with `defineEvaluator` from `@groundrule/core`.
