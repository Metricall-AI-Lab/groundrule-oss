# ADR 0011: Architecture rules for Java, Kotlin and Go

- **Status:** Accepted
- **Date:** 27 October 2026
- **Extends:** ADR 0009 (architecture rules as deterministic primitives), RFC 0011 (architecture discovery)

## Context

The `imports` evaluator and architecture discovery read TypeScript, JavaScript and Python. ADR 0009 said Java and Go would follow in the same evaluator. Teams on Spring and on Go services ask for the same three rules (a layer that must not import another, a module reachable only through its entry, a package only one module may use), and their coding agents cross the same lines. The `java-spring` and `go` packs already ship conventions for both; the `architecture` pack says nothing true on their repositories until the evaluator understands their imports.

## Decision

The same evaluator, the same options, the same resolution rule, three more languages. Nothing changes in the document format, the `Evaluator` interface or the `imports` options; `ScanImports` (RFC 0004, RFC 0011) keeps its shape.

**Which files.** `.java`, `.kt` and `.kts` (Kotlin's import statement is Java's without the semicolon, and the two share source trees) and `.go`.

**Scanning.** Tolerant patterns, as before, with comments blanked:

- Java and Kotlin: `import a.b.C;`, `import static a.b.C.m;` (the member dropped), `import a.b.*;`, Kotlin `import a.b.C as D` (the alias dropped). The specifier is the qualified name as written, with `.*` kept.
- Go: `import "path"`, `import alias "path"`, `import _ "path"`, `import . "path"`, and the same inside an `import ( … )` block. The specifier is the import path.

**Resolution to the repository.** The rule of ADR 0009 holds: whatever does not resolve to a repository path is a package, never a layer violation.

- Java and Kotlin resolve through **source roots**: every directory of the form `…/src/main/java`, `…/src/test/java`, `…/src/main/kotlin`, `…/src/test/kotlin` that holds a file, plus the repository root and `src` as fallbacks. `a.b.C` resolves to `<root>/a/b/C.java` or `.kt`; a nested class `a.b.Outer.Inner` to `<root>/a/b/Outer.java`; a wildcard `a.b.*` to the directory `<root>/a/b` when any file lives under it. A static import resolves like its class. Unresolved imports are packages named by the qualified name without `.*` (`org.springframework.jdbc.core.JdbcTemplate`, `java.util`), so a gate is written as `package: "org.springframework.jdbc.*"` or `"java.sql.*"`.
- Go resolves through **modules**: every `go.mod` in the repository gives a module path and a directory (nested modules and `go.work` workspaces included). An import under a module path resolves to the package's directory, `<module dir>/<rest>`, when any file lives in it. The resolved path is the directory, which `forbid: ["internal/infra/**"]` matches. Unresolved imports are packages named by the import path (`database/sql`, `github.com/stripe/stripe-go/v76`), so a gate is written as `package: "github.com/stripe/**"`.

**What stays invisible, by design.** Same-package references in Java and Go need no import statement and are not seen; the rules are about crossing a boundary, and a boundary is never inside one package. Go's `replace` directives and vendored copies are not followed: a replaced module still resolves by its import path when the path is under a module in the repository, and otherwise is a package. Kotlin's default imports and Java's `java.lang` need no statement and are not seen.

**Discovery (RFC 0011).** Modules for the new languages:

- Go: the first directory under `internal`, `pkg` or `cmd`, which join the source roots; otherwise the top-level directory, as for other languages.
- Java and Kotlin: for each source root, the longest directory prefix shared by all its files (the group and artifact, `com/acme/shop`), then the next segment: `src/main/java/com/acme/shop/orders`. Test roots are read but propose nothing on their own.

The gated-package list grows with the JDBC, JPA and Hibernate packages, `java.sql`, the Stripe, AWS, Google Cloud and Azure SDKs, OkHttp and Apache HttpClient, Lettuce and Jedis, Kafka, and for Go `database/sql`, GORM, pgx, lib/pq, the MongoDB and Redis drivers, the cloud SDKs, kafka-go and golang-jwt. A Java entry that ends in a dot is a prefix, and a gate it proposes is written as that prefix plus `*` (`org.springframework.jdbc.*`), so the accepted rule covers the package and not one class.

**The pack.** The `architecture` rules that are about directories and packages (ARCH-001, 002, 005, 007, 008) apply to Java, Kotlin and Go as well, with Java and Go examples; the rules about `index` entry files (003, 004, 006) stay TypeScript and JavaScript, since the other languages have no index file. Paths stay conventional and adjustable; discovery proposes the real ones.

## Consequences

- One scanner and one resolver per language family in `@groundrule/core`, behind the same `buildImportGraph` and `resolveImport`; the evaluator chooses by extension. No new dependency.
- Precision stays where ADR 0009 put it: a layer rule can only fire on an import that resolved to the repository, and the resolution for Java needs the file to exist under a source root, for Go the package directory to exist under a module in the repository.
- A Java repository with a layout other than `src/main/java` (an Ant tree, a single `src`) resolves through the fallback roots and may resolve less; a gate still works, since gates never need resolution.
- Discovery on a Java monorepo proposes per Maven or Gradle module, because each has its own source root; cross-module boundaries are proposed when the modules import each other by qualified name and both are in the repository.
