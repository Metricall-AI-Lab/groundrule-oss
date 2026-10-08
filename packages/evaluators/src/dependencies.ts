import { defineEvaluator, type EvaluatorFinding } from "@groundrule/core";
import picomatch from "picomatch";
import { z } from "zod";
import {
  type Ecosystem,
  manifestEcosystem,
  normalizePythonName,
  parseManifest,
} from "./manifests.js";
import { readText } from "./util.js";

const ECOSYSTEMS = ["npm", "maven", "gradle", "pip", "go", "cargo"] as const;

const Options = z.strictObject({
  /**
   * Dependency names or globs. npm: "axios", "@aws-sdk/*". Maven/Gradle: "group:artifact"
   * or just "artifact". pip: package name. Go: module path. Cargo: crate name.
   */
  forbid: z
    .array(z.string().min(1, "Dependency names can't be empty"))
    .min(1, "List at least one dependency to forbid"),
  ecosystems: z.array(z.enum(ECOSYSTEMS)).optional(),
  /** Approved replacements, shown in the remediation. */
  allowInstead: z.array(z.string().min(1)).optional(),
  message: z.string().min(1).optional(),
});

export const dependenciesEvaluator = defineEvaluator({
  id: "dependencies",
  source: "deterministic",
  description: "Forbid dependencies in package manifests (npm, Maven, Gradle, pip, Go, Cargo).",
  optionsSchema: Options,
  async evaluate({ options, context }) {
    const findings: EvaluatorFinding[] = [];
    const ecosystems = new Set<Ecosystem>(options.ecosystems ?? ECOSYSTEMS);
    const matchers = options.forbid.map((pattern) => ({ pattern, test: matcherFor(pattern) }));

    for (const file of context.targetFiles) {
      if (file.includes("node_modules/")) continue;
      const ecosystem = manifestEcosystem(file);
      if (!ecosystem || !ecosystems.has(ecosystem)) continue;
      const text = await readText(context.readFile, file);
      if (text === undefined) continue;

      for (const dep of parseManifest(file, text)) {
        const hit = matchers.find((m) => m.test(dep.name, dep.ecosystem));
        if (!hit) continue;
        findings.push({
          status: "violation",
          confidence: "certain",
          message: options.message ?? `Forbidden dependency "${dep.name}"`,
          location: { file, startLine: dep.line },
          evidence: [
            `${file} declares ${dep.name} (${dep.ecosystem}), which matches "${hit.pattern}"`,
          ],
          ...(options.allowInstead?.length
            ? { remediation: `Use ${options.allowInstead.join(" or ")} instead.` }
            : {}),
          snippet: `${dep.ecosystem}:${dep.name}`,
        });
      }
    }
    return findings;
  },
});

function matcherFor(pattern: string) {
  const glob = picomatch(pattern, { dot: true });
  const python = normalizePythonName(pattern);
  return (name: string, ecosystem: Ecosystem): boolean => {
    if (glob(name) || name === pattern) return true;
    if (ecosystem === "pip") return name === python;
    if ((ecosystem === "maven" || ecosystem === "gradle") && !pattern.includes(":")) {
      return glob(name.slice(name.indexOf(":") + 1));
    }
    return false;
  };
}
