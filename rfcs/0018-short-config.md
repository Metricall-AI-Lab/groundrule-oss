# RFC 0018: A config file without the header

- **Status:** Proposed (19 November 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
`.groundrule/config.yaml` may leave out `apiVersion` and `kind`. `groundrule init` and `groundrule start` write the common case in a few lines: the packs, the agent files, and a pointer to the rest.

## Motivation
A new repository's config opened like this:

```yaml
# yaml-language-server: $schema=https://groundrule.dev/schemas/v1alpha1/config.schema.json
apiVersion: groundrule.dev/v1alpha1
kind: Config
```

followed by `tags: []` and an `enforcement` block that only repeated the defaults. It was correct, and to someone skimming it said "this will take a while". Every other document kind needs `kind`, because a standards folder holds several kinds and a reader has to tell them apart. The config file doesn't: there is exactly one, and it is found by its path.

## Proposal

### The format
In the `Config` kind, `apiVersion` defaults to `groundrule.dev/v1alpha1` and `kind` defaults to `Config`. Both may still be written, and when written must hold those values.

A loader that is asked for a config (it knows the path) accepts a document with no `kind`. A loader that is not told what to expect still needs `kind` to pick a schema, so `groundrule validate some-file.yaml` on a file with no `kind` is unchanged.

No other kind changes. A `Standard`, `ActionPolicy`, `Exceptions` or report document without `kind` is refused as before.

### What `init` writes

```yaml
# The rules this repository follows. `groundrule packs` lists more.
extends:
  - groundrule:packs/essentials

# The files `groundrule sync` writes for your coding agents.
targets:
  - agents-md
  - claude-code

# More settings (tags, what fails a check, per-rule overrides):
# https://docs.groundrule.dev/developers/cli/init-and-config/
```

`tags` and `enforcement` are left out because they would only state their defaults: no tags, changed lines, existing findings reported, fail on blockers. The editor schema comment is left out too; the docs say how to add it.

## Compatibility
- **Existing files:** unchanged. A config with the header reads exactly as before.
- **Older CLIs:** a CLI before this release refuses a config without `kind` ("Expected kind \"Config\", found none"). A repository whose config was written by this release therefore needs this release or later everywhere it is read: on each machine, in CI, and in a hosted check. `npx @groundrule/cli` and the GitHub Action resolve the latest release; the agent hooks pin the version that installed them. Hosted checks pick the change up with the platform's next worker release.
- **JSON Schema:** `apiVersion` and `kind` are no longer in `required` for `config.schema.json`.

## Alternatives considered
- **Keep the header, hide it behind a comment.** Still two lines nobody reads.
- **Infer `kind` for every document from its folder.** Standards and action policies share folders, so this would guess.
- **A second, shorter file name.** Two places to look for one thing.

## Unresolved
None.
