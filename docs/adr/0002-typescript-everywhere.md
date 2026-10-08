# ADR 0002: TypeScript for the kernel, CLI, and cloud

- **Status:** Accepted
- **Date:** 2026-10-07

## Context
The product spans a CLI, an MCP server, a GitHub Action, a backend, and a web dashboard. The team is small. MCP and LLM SDKs are first-class in TypeScript. Go would give a nicer single-binary CLI.

## Decision
TypeScript (strict, ESM) on Node >= 22 everywhere. Heavy analysis is delegated to native tools (tree-sitter, ast-grep, Semgrep). Packages are compiled with `tsc` only (no bundler) for predictable output.

## Consequences
- One language, shared types between spec, engine, API, and UI.
- CLI distributed via npm first; standalone binaries later via Node single-executable applications.
- Revisit if CLI startup or scan performance becomes a real user complaint.
