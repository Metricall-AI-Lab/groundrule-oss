---
"@groundrule/core": minor
"@groundrule/evaluators": minor
"@groundrule/packs": minor
"@groundrule/cli": minor
---

Architecture rules for Java, Kotlin and Go (ADR 0011). The `imports` check and `groundrule scan`'s architecture discovery now read `.java`, `.kt`, `.kts` and `.go` files: Java and Kotlin imports resolve through Maven and Gradle source roots (`src/main/java`, `src/main/kotlin`, nested classes and wildcard imports included), Go imports through every `go.mod` in the repository, nested modules included. Unresolved imports are packages, so a gate is written as `package: "org.springframework.jdbc.*"` or `"github.com/stripe/**"`. Discovery proposes Java modules under the source root's shared package and Go modules under `internal`, `pkg` and `cmd`, and gates the JDBC, JPA, Hibernate, cloud, HTTP-client, Redis, Kafka, GORM, pgx and driver packages. The `architecture` pack's directory and package rules (ARCH-001, 002, 005, 007, 008) apply to the three languages, with Java and Go examples.
