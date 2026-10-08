# @groundrule/spec

Schemas and TypeScript types for the Groundrule document format (`groundrule.dev/v1alpha1`).

| Kind | File | Purpose |
|------|------|---------|
| `Standard` | `.groundrule/standards/*.yaml` | One engineering rule: scope, intent, requirement, examples, checks |
| `Pack` | `pack.yaml` | A reusable group of standards |
| `Config` | `.groundrule/config.yaml` | Per-repository configuration |
| `ExceptionList` | `.groundrule/exceptions.yaml` | Time-boxed exceptions |
| `Finding` | (output) | The result of evaluating a standard |

JSON Schemas are published in `schemas/` for editor autocomplete:

```yaml
# yaml-language-server: $schema=https://groundrule.dev/schemas/v1alpha1/standard.schema.json
```
