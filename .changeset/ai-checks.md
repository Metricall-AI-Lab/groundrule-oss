---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/evaluators": minor
"@groundrule/cli": minor
---

AI checks (RFC 0013): the `llm` evaluator's options are now `question`, `include`, `exclude` and `minConfidence`, answered by Groundrule's hosted checks over the changed lines of the files the rule names; locally and in CI the rule is reported as not run. `groundrule check --ai-requests <file>` writes the review requests (`AiReviewRequests`: hunks with context, secrets redacted, within per-run limits) for the hosted worker.
