# RFC 0002: Connecting a repository to the Groundrule platform

- **Status:** Accepted
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add an optional `platform` block to `Config` so a repository can take its standards from an organization on the Groundrule platform instead of listing packs in `extends`. Optional and backward compatible: configs without it behave exactly as before.

```yaml
apiVersion: groundrule.dev/v1alpha1
kind: Config
platform:
  org: acme                      # required: the organization's URL name
  url: https://app.groundrule.dev  # optional; default shown
  repository: acme/payments-api  # optional; defaults to the git remote
targets: [agents-md, claude-code]
```

## Motivation
Organizations adopt packs rule by rule on the platform: they turn rules off with a reason, change severity and wording, scope them to teams and repositories, and move each rule through rollout stages (observe, teach, advise, enforce). Copying that into every repository's config would fork it. A repository should instead point at the organization and receive the resolved rulebook.

## Proposal
- `platform.org` (string, URL name), `platform.url` (http(s) URL, optional), `platform.repository` (string, optional).
- When `platform` is set, the CLI fetches the organization's rulebook for the repository and uses it instead of `extends` (which is ignored, with a warning). Standards in `.groundrule/standards/` still apply; on an ID clash the organization's rule wins.
- Stages decide how each command uses a rule: `sync` delivers Teach, Advise, and Enforce rules to agents; `check` runs Enforce rules as defined and Advise rules with blockers lowered to warnings; Observe rules stay on the platform.
- Credentials are not part of the config. The CLI reads `GROUNDRULE_TOKEN` or a login saved by `groundrule login`, and only sends tokens over https (plain http only for localhost).

## Compatibility
Additive. Older CLIs reject configs with `platform` (strict schema), which is the desired failure: they would otherwise silently fall back to `extends`.

## Alternatives considered
- A remote pack (`extends: [platform:acme]`): fits the existing source-ref model, but packs carry no rollout stage or per-repository resolution, and it would mix authenticated sources into a list meant for static ones.
