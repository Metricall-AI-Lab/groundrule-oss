# Contributing to Groundrule

Thanks for helping. A few things keep the project healthy:

## Before you start
- For bugs and small fixes, open a PR directly.
- For new features, open an issue first.
- For changes to the document format (`packages/spec`), write an RFC in [`rfcs/`](rfcs/).

## Development
```bash
pnpm install
pnpm check     # lint, build, typecheck, test
pnpm format    # autofix formatting
```

## Pull requests
- Include tests. Bug fixes start with a failing regression test.
- Add a changeset (`pnpm changeset`) for user-facing changes to published packages.
- Keep PRs small and focused.
- Sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/).

## Good first issues
Issues labelled [`good first issue`](https://github.com/Metricall-AI-Lab/groundrule-oss/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are scoped so a first contribution fits in an evening, with pointers to the files involved. Comment on one to claim it; ask anything in the issue or in [Discussions](https://github.com/Metricall-AI-Lab/groundrule-oss/discussions).

## Writing evaluators and packs
- **Packs** are folders of standards in [`packages/packs/catalog`](packages/packs/catalog). The rule format is documented at [docs.groundrule.dev/developers/rules/rule-format](https://docs.groundrule.dev/developers/rules/rule-format/) and packs at [docs.groundrule.dev/developers/rules/packs](https://docs.groundrule.dev/developers/rules/packs/). A new pack needs a README, every rule's `why` and `fix`, and a fixture under `packages/packs/fixtures` that the tests run.
- **Evaluators** live in [`packages/evaluators/src`](packages/evaluators/src); `files.ts` and `regex.ts` are the smallest to read first. An evaluator takes a check definition and a change set and returns findings; see [`packages/spec/schemas/finding.schema.json`](packages/spec/schemas/finding.schema.json). New evaluators start as an RFC in [`rfcs/`](rfcs/).
- **Adapters** (the agent files Groundrule writes) are in [`packages/adapters/src`](packages/adapters/src).

## Where to ask
[Discussions](https://github.com/Metricall-AI-Lab/groundrule-oss/discussions) for questions and ideas, issues for bugs, [security@groundrule.dev](SECURITY.md) for anything security-related.
