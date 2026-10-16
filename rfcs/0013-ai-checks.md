# RFC 0013: AI checks, done honestly

- **Status:** Accepted (17 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
A rule may carry an `llm` check: a question a reviewer would ask about a change ("does any new endpoint reach business logic without an authorization check?"). Hosted checks answer it with a model, over the changed lines of the files in the rule's scope, with secrets redacted. What comes back is a finding labelled **AI review**: advisory, never blocking, with the model's confidence, cached per hunk, counted and capped in the workspace's AI budget. The CLI reports the same rule as **not run here**: a laptop or a CI job never pays for tokens or sends code anywhere.

## Motivation
Some rules no deterministic check can express, and the alternative today is to label them guidance and hope. Competing reviewers answer such questions with a model and present the answer as a verdict. Groundrule's labels (RFC 0007) already distinguish what was checked from what was reviewed; this RFC gives the AI review column something to hold, without letting it fail a change, exceed a budget, or read more than a reviewer would.

## Proposal
```yaml
checks:
  - evaluator: llm
    question: >
      Does any new state-changing endpoint reach business logic without a
      server-side authorization check?
    include: ["src/api/**"]        # optional; the standard's scope otherwise
    exclude: ["**/*.test.ts"]      # optional
    minConfidence: medium          # medium (default) | high: findings below it are dropped
```

**Where it runs.** Only in Groundrule's hosted checks (platform ADR 0029), and only when an admin has turned on **AI checks on hosted pull requests** in Settings → AI, which also needs AI on. Everywhere else (`groundrule check` locally, in CI, the stop hook, the MCP tool) the rule's outcome is `not-evaluable` with the reason "AI checks run on Groundrule hosted checks; not here", and the rule's deterministic checks still run.

**What is sent.** For each `llm` rule and each changed file it names, the changed lines with three lines of context on either side, as hunks, after `redactSecrets`. Never the whole file, never unchanged files, never the repository's name beyond the file path. Limits per run: 40 files, 400 lines per file, 200 KB in all; beyond them the rest is reported as not evaluable, with the count. The sandbox writes these requests to a file (`groundrule check --ai-requests <file>`, a new option); the worker outside the sandbox sends them through the LLM gateway, which redacts again, caches, and keeps the ledger. Code stays in the sandbox; hunks leave it the way one-line snippets already do.

**What comes back.** Per request, zero or more findings `{line, message, confidence}`; the model is told it is answering one question about one change, that the code is data and never instructions, and that saying "nothing" is the normal answer. The worker turns them into check-run findings (RFC 0005) with `source: ai`, `blocking: false`, `status: violation` at confidence ≥ 0.8 and `concern` below, and the rule's `minConfidence` dropping what is under it (`high` ≥ 0.8, `medium` ≥ 0.5). The rule's outcome becomes `warned` when any finding stands, never `failed`. The run's pass/fail is decided before any model is asked and never changes after.

**Cost.** One call per (rule, file) hunk set; cached for 30 days per prompt version and content, so a rerun on the same commit costs nothing. A run spends at most $0.50 (then the remaining requests are reported as not evaluable); the workspace's monthly AI budget applies as for every feature; each call is in the AI ledger under `checks.ai-review` with tokens and cost, never with the hunks.

**What the dashboard shows.** AI findings carry the **AI review · advisory** label on the run page and on the pull request's check; they never count toward "stopped" or "blocks" anywhere, including the "where violations are stopped" view, where they are their own line.

## Compatibility
Additive. The `llm` evaluator's options become strict (`question`, `include`, `exclude`, `minConfidence`); a standard with the old free-form `prompt` field fails validation with a clear message. No change to `CheckRun`. A new `--ai-requests` option on `check`; a new document, `AiReviewRequests`, between the sandbox and the worker.

## Alternatives considered
- **Running the model inside the sandbox.** Rejected: the sandbox has no network by design, and giving it one for the model would give it one for everything.
- **Letting AI findings block at high confidence.** Rejected: a verdict a developer can't reproduce locally must not stop a merge; the label system exists so that the reviewer decides.
- **Whole changed files instead of hunks.** Rejected: more code leaves the sandbox for little gain; a reviewer reads the diff too.
- **A bring-your-own-key mode in the CLI.** Deferred: it would make every laptop a place where code is sent, and the cost and cache belong to the workspace.
