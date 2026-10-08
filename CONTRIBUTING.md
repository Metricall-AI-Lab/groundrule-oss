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

## Writing evaluators and packs
Guides are coming with the evaluator SDK and the first community packs.
