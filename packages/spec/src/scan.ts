import { z } from "zod";
import { ApiVersion, Severity, StandardId } from "./common.js";
import { ContributorDigest } from "./contributors.js";

/** Coding-agent instruction files `groundrule scan` recognizes. */
export const AGENT_FILE_KINDS = [
  "agents-md",
  "claude-md",
  "claude-rules",
  "cursor-rules",
  "cursorrules",
  "copilot-instructions",
  "copilot-path-instructions",
  "gemini-md",
  "windsurf-rules",
  "aider-conventions",
] as const;
export const AgentFileKind = z.enum(AGENT_FILE_KINDS);
export type AgentFileKind = z.infer<typeof AgentFileKind>;

/** How a catalog rule came out on a repository, observed without enforcing anything. */
export const SCAN_OUTCOMES = [
  "clean",
  "violations",
  "guidance",
  "not-applicable",
  "not-evaluable",
] as const;
export const ScanOutcome = z.enum(SCAN_OUTCOMES);
export type ScanOutcome = z.infer<typeof ScanOutcome>;

const RelPath = z.string().min(1).max(400).describe("Repository-relative POSIX path.");
const Count = z.number().int().nonnegative().max(10_000_000);

export const ScanAgentFile = z.strictObject({
  path: RelPath,
  kind: AgentFileKind,
  lines: Count,
  bytes: Count,
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe("Content hash, to notice changes."),
  managed: z.boolean().describe("Contains a block written by `groundrule sync`."),
  headings: Count,
  bullets: Count,
});
export type ScanAgentFile = z.infer<typeof ScanAgentFile>;

export const ScanTool = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(40)
    .describe("Tool, e.g. eslint, ruff, codeowners."),
  path: RelPath,
  facts: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((r) => Object.keys(r).length <= 10, "At most 10 facts")
    .default({})
    .describe("A few configuration facts, e.g. { strict: true }. Never file contents."),
});
export type ScanTool = z.infer<typeof ScanTool>;

export const ScanExample = z.strictObject({
  file: RelPath.optional(),
  line: z.number().int().positive().optional(),
  message: z.string().min(1).max(300),
  snippet: z
    .string()
    .max(200)
    .optional()
    .describe("One line of code, secrets redacted. Omitted for secret-detection rules."),
});
export type ScanExample = z.infer<typeof ScanExample>;

export const ScanRule = z.strictObject({
  id: StandardId,
  version: z.number().int().positive(),
  pack: z
    .string()
    .min(1)
    .max(120)
    .describe("Where the rule comes from, e.g. groundrule:packs/python."),
  severity: Severity,
  outcome: ScanOutcome,
  findings: Count,
  filesInScope: Count.describe("Files the rule looks at in this repository."),
  filesAffected: Count.describe("Files with at least one finding."),
  examples: z.array(ScanExample).max(3).default([]),
  reason: z.string().max(300).optional(),
});
export type ScanRule = z.infer<typeof ScanRule>;

const SourceLine = z.strictObject({
  file: RelPath,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
});

/** How firmly an instruction is worded: "must/never", "should/prefer", or neither. */
export const INSTRUCTION_STRENGTHS = ["must", "should", "info"] as const;

/**
 * One instruction found in an agent file (a bullet, numbered item, or directive
 * paragraph), as a candidate rule. Its text leaves the machine, redacted, unless the scan
 * runs with --no-import.
 */
export const ImportedInstruction = z.strictObject({
  text: z.string().min(1).max(1000),
  section: z.string().max(200).optional().describe("Heading path, e.g. Testing › Mocks."),
  strength: z.enum(INSTRUCTION_STRENGTHS),
  scope: z
    .strictObject({ paths: z.array(z.string().min(1).max(200)).max(20) })
    .optional()
    .describe("From Cursor globs or Copilot applyTo."),
  sources: z.array(SourceLine).min(1).max(10),
  similar: z
    .array(z.strictObject({ id: StandardId, score: z.number().min(0).max(1) }))
    .max(3)
    .default([])
    .describe("Catalog rules with similar wording (keyword match, not AI)."),
  fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe("Hash of the normalized text."),
});
export type ImportedInstruction = z.infer<typeof ImportedInstruction>;

/** A linter or compiler setting that corresponds to a catalog rule. */
export const ImportedToolSetting = z.strictObject({
  tool: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(40),
  setting: z.string().min(1).max(120).describe("e.g. no-console, T201, strict."),
  value: z.string().max(60).describe("As configured, e.g. error, warn, off, true."),
  stance: z.enum(["enforced", "warned", "disabled"]),
  standardId: StandardId,
  source: z.strictObject({ file: RelPath, line: z.number().int().positive().optional() }),
});
export type ImportedToolSetting = z.infer<typeof ImportedToolSetting>;

/** A CODEOWNERS entry, with the rule category it suggests ownership of. */
export const ImportedOwner = z.strictObject({
  pattern: z.string().min(1).max(300),
  owners: z.array(z.string().min(1).max(120)).min(1).max(20),
  category: z.string().max(40).optional(),
  repositoryDefault: z.boolean().describe("The catch-all entry (*), i.e. who owns the repository."),
  source: SourceLine,
});
export type ImportedOwner = z.infer<typeof ImportedOwner>;

/** A boundary the repository already keeps (RFC 0011): `from` rarely or never imports `forbid`. */
export const ImportedBoundary = z.strictObject({
  from: RelPath.describe("The module that must not import, e.g. src/domain."),
  forbid: RelPath.describe("The module it must not import, e.g. src/infra."),
  files: z.number().int().nonnegative().describe("Files in `from`."),
  importsBack: z
    .number()
    .int()
    .nonnegative()
    .describe("Files in `forbid` that import `from`: the direction's evidence."),
  violations: z
    .number()
    .int()
    .nonnegative()
    .describe("Files in `from` that import `forbid` today."),
  examples: z
    .array(z.strictObject({ file: RelPath, line: z.number().int().positive(), target: RelPath }))
    .max(3),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ImportedBoundary = z.infer<typeof ImportedBoundary>;

/** A package one module owns (RFC 0011): used from `only`, and rarely or never elsewhere. */
export const ImportedGate = z.strictObject({
  package: z.string().min(1).max(120),
  only: RelPath.describe("The module that uses the package, e.g. src/payments."),
  users: z.number().int().nonnegative().describe("Files in `only` that import it."),
  violations: z.number().int().nonnegative().describe("Files elsewhere that import it today."),
  examples: z.array(z.strictObject({ file: RelPath, line: z.number().int().positive() })).max(3),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ImportedGate = z.infer<typeof ImportedGate>;

/** A layout convention the repository already keeps (RFC 0016), as a proposed `layout` rule. */
export const ImportedLayout = z
  .strictObject({
    kind: z.enum(["place", "companion"]),
    from: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(10)
      .describe("The files the rule applies to."),
    exclude: z.array(z.string().min(1).max(200)).max(10).optional(),
    place: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(5)
      .optional()
      .describe("Where the kind of file lives, e.g. **/api/**."),
    companion: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(5)
      .optional()
      .describe("The companion every file has, e.g. {dir}/{base}.test{ext}."),
    files: z.number().int().nonnegative().describe("Files the convention was measured on."),
    violations: z.number().int().nonnegative().describe("Of them, the ones that break it today."),
    examples: z.array(z.strictObject({ file: RelPath })).max(3),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine((l) => (l.kind === "place" ? Boolean(l.place) : Boolean(l.companion)), {
    message: "A place has `place`; a companion has `companion`.",
  });
export type ImportedLayout = z.infer<typeof ImportedLayout>;

/** One import statement, resolved (RFC 0015): a repository path or a package, never code. */
export const ImportEdge = z
  .strictObject({
    file: RelPath.describe("The importing file."),
    line: z.number().int().positive().describe("The import statement's line."),
    path: RelPath.optional().describe("The repository file or directory the import resolved to."),
    package: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("The package name or import path, when the import is not repository code."),
  })
  .refine((e) => Boolean(e.path) !== Boolean(e.package), {
    message: "An edge has either `path` or `package`.",
  });
export type ImportEdge = z.infer<typeof ImportEdge>;

export const IMPORT_GRAPH_MAX_EDGES = 20_000;
export const ImportGraph = z.strictObject({
  edges: z
    .array(ImportEdge)
    .max(IMPORT_GRAPH_MAX_EDGES)
    .describe("Every resolved import, sorted by file then line, capped."),
  truncated: z.boolean().describe("True when the cap cut the list."),
});
export type ImportGraph = z.infer<typeof ImportGraph>;

export const ScanImports = z.strictObject({
  instructions: z.array(ImportedInstruction).max(500),
  toolSettings: z.array(ImportedToolSetting).max(300),
  owners: z.array(ImportedOwner).max(200),
  boundaries: z
    .array(ImportedBoundary)
    .max(25)
    .default([])
    .describe("Architecture boundaries the code already keeps, as proposals (RFC 0011)."),
  gates: z
    .array(ImportedGate)
    .max(15)
    .default([])
    .describe("Packages one module owns, as proposals (RFC 0011)."),
  layouts: z
    .array(ImportedLayout)
    .max(15)
    .default([])
    .describe("Layout conventions the code already keeps, as proposals (RFC 0016)."),
  graph: ImportGraph.optional().describe(
    "The resolved import graph (RFC 0015): file, line, and the path or package each import points at. The platform previews architecture rules against it.",
  ),
});
export type ScanImports = z.infer<typeof ScanImports>;

/**
 * What `groundrule scan` learned about a repository: its stack, existing agent files and
 * tool configurations, and how every applicable catalog rule would do today. It holds
 * counts and at most a few one-line snippets per rule, never whole files.
 */
export const ScanReport = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("ScanReport"),
    metadata: z.strictObject({
      generatedAt: z.iso.datetime({ offset: true }),
      cliVersion: z.string().min(1).max(40),
      durationMs: Count,
      snippets: z.boolean().describe("Whether code snippets were included."),
    }),
    repository: z.strictObject({
      name: z
        .string()
        .min(1)
        .max(200)
        .describe("owner/name from the git remote, or the folder name."),
      commit: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
      branch: z.string().min(1).max(255).optional(),
      files: Count,
    }),
    stack: z.strictObject({
      languages: z.array(z.string().min(1).max(40)).max(40),
      frameworks: z.array(z.string().min(1).max(40)).max(40),
    }),
    agentFiles: z.array(ScanAgentFile).max(100),
    tools: z.array(ScanTool).max(100),
    rules: z.array(ScanRule).max(2000),
    imports: ScanImports.optional().describe(
      "Existing instructions, tool settings, and owners, as proposals (RFC 0004). Omitted with --no-import.",
    ),
    contributors: ContributorDigest.optional(),
    summary: z.strictObject({
      rules: Count,
      clean: Count,
      violations: Count,
      guidance: Count,
      notApplicable: Count,
      notEvaluable: Count,
      findings: Count,
    }),
  })
  .describe("A repository scan, produced by `groundrule scan` and uploaded with --upload.");
export type ScanReportInput = z.input<typeof ScanReport>;
export type ScanReport = z.infer<typeof ScanReport>;
