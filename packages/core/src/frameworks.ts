/**
 * Framework detection from manifests. Deliberately simple and conservative:
 * a framework is reported only when a manifest declares it.
 */
const NPM_FRAMEWORKS: Record<string, string> = {
  react: "react",
  next: "nextjs",
  vue: "vue",
  svelte: "svelte",
  "@angular/core": "angular",
  express: "express",
  fastify: "fastify",
  "@nestjs/core": "nestjs",
  hono: "hono",
};

const JVM_MARKERS: Array<[RegExp, string]> = [
  [/spring-boot/, "spring-boot"],
  [/io\.quarkus/, "quarkus"],
  [/io\.micronaut/, "micronaut"],
];

const PYTHON_MARKERS: Array<[RegExp, string]> = [
  [/^\s*["']?django\b/im, "django"],
  [/^\s*["']?flask\b/im, "flask"],
  [/^\s*["']?fastapi\b/im, "fastapi"],
];

export async function detectFrameworks(
  files: readonly string[],
  readFile: (path: string) => Promise<string>,
): Promise<string[]> {
  const found = new Set<string>();
  const manifests = files.filter((f) => !f.includes("node_modules/"));

  for (const file of manifests) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    let text: string;
    if (name === "package.json") {
      text = await readFile(file).catch(() => "");
      try {
        const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
        for (const deps of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
          for (const dep of Object.keys(deps ?? {})) {
            const framework = NPM_FRAMEWORKS[dep];
            if (framework) found.add(framework);
          }
        }
      } catch {
        // Invalid package.json: nothing to detect.
      }
    } else if (name === "pom.xml" || name === "build.gradle" || name === "build.gradle.kts") {
      text = await readFile(file).catch(() => "");
      for (const [pattern, framework] of JVM_MARKERS) if (pattern.test(text)) found.add(framework);
    } else if (name === "pyproject.toml" || /^requirements.*\.txt$/.test(name)) {
      text = await readFile(file).catch(() => "");
      for (const [pattern, framework] of PYTHON_MARKERS)
        if (pattern.test(text)) found.add(framework);
    }
  }
  return [...found].sort();
}
