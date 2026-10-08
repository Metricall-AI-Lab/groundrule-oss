# @groundrule/packs

Bundled standard packs, referenced as `groundrule:packs/<name>`. 171 standards in 13 packs; 93 have deterministic checks, the rest are guidance delivered to coding agents.

| Pack | Version | Standards | Covers |
|------|---------|-----------|--------|
| `security-baseline` | 1.1.0 | 20 | Secrets and keys, `.env` files, TLS, lockfiles, logging, injection, deserialization, cookies, CORS, JWT, SSRF, randomness |
| `typescript-node` | 1.1.0 | 15 | `console.log`, `eval`, strict mode, `node:` imports, `Buffer()`, `debugger`, typed catches, promises |
| `react` | 1.0.0 | 12 | `dangerouslySetInnerHTML`, keys, `target="_blank"`, `alt`, client-exposed secrets, hooks, effects |
| `java-spring` | 1.1.0 | 16 | Injection style, logging, layering, `@Transactional`, SQL building, config secrets, Actuator, CSRF, `java.time` |
| `python` | 1.0.0 | 16 | Bare `except`, mutable defaults, `print`, pickle/YAML loading, `shell=True`, `eval`, timeouts, debug mode |
| `go` | 1.0.0 | 13 | Error wrapping, `panic`, HTTP timeouts, SQL placeholders, `crypto/rand`, goroutine lifetimes |
| `docker` | 1.0.0 | 12 | Non-root images, pinned bases, `COPY` vs `ADD`, `curl \| sh`, secrets in `ENV`, apt hygiene |
| `kubernetes` | 1.0.0 | 12 | Privileged pods, host namespaces, privilege escalation, `runAsNonRoot`, resources, image tags, Secrets, RBAC |
| `terraform` | 1.0.0 | 12 | Credentials, lock file, module pinning, open SSH/RDP, public buckets, state files |
| `github-actions` | 1.0.0 | 10 | SHA-pinned actions, token permissions, script injection, `pull_request_target`, OIDC |
| `http-api` | 1.0.0 | 12 | Error shape, status codes, pagination, idempotency, versioning, authorization, rate limits |
| `testing` | 1.0.0 | 11 | Focused and skipped tests, sleeps, regression tests, determinism, snapshots, committed reports |
| `agent-hygiene` | 1.0.0 | 10 | How AI coding agents should work: generated files, dependencies, scope, checks, merge leftovers |

## Quality bar

Every catalog standard carries the metadata from [RFC 0001](../../rfcs/0001-catalog-metadata.md): intent, a noise rating with known false positives, and a recommended rollout stage; checked standards say how to fix a violation, and security standards cite references (CWE titles match MITRE exactly). `test/catalog-quality.test.ts` enforces it.

## Precision harness

Every standard with checks has `fixtures/<pack>/<ID>.yaml`: small repositories that **must** be flagged (`violation`) and realistic near misses that **must not** be (`clean`). `test/catalog-fixtures.test.ts` runs each case in its own git repository with only that pack enabled, and fails if a checked standard lacks either kind of case.

```yaml
standard: TS-003
cases:
  - name: eval of user input
    expect: violation
    files:
      src/rules.ts: "export const run = (expr: string) => eval(expr);\n"
  - name: methods named eval and the word in comments
    expect: clean
    files:
      src/rules.ts: "const result = await model.eval(input); // never call eval()\n"
```

When a check misfires on real code, add the case that reproduced it as a `clean` fixture, then fix the check. The catalog was also run against seven real repositories (Flask, Express, Spring PetClinic, Gin, Bulletproof React, Online Boutique, terraform-aws-vpc); each false positive found there is now a regression fixture.

Fixtures live outside `catalog/`, so they are not published.

**Secret-shaped test values:** split them with `⟨⟩` (e.g. `npm_lc0q13yh⟨⟩rW0g2C…`). The harness removes the marker when it writes each case, so the committed files contain nothing a secret scanner or GitHub push protection would flag. Never commit a real credential, even an expired one.
