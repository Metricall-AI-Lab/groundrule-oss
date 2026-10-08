# @groundrule/packs

Bundled standard packs, referenced as `groundrule:packs/<name>`:

| Pack | Standards |
|------|-----------|
| `security-baseline` | Private keys, `.env` files, access tokens, disabled TLS, lockfiles, logging secrets |
| `typescript-node` | `console.log`, `eval`, deprecated packages, `@ts-ignore`, boundary validation |
| `java-spring` | Constructor injection, logging, controllers vs repositories, thin controllers |

Every pack standard has a behavior test in `test/packs.test.ts`: it must catch real violations and stay quiet on correct code.
