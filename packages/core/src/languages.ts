const EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  sql: "sql",
  tf: "terraform",
  sh: "shell",
  bash: "shell",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "css",
  html: "html",
  vue: "vue",
  svelte: "svelte",
};

/** Language of a file from its extension, or undefined if unknown. */
export function languageOf(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return undefined;
  return EXTENSIONS[path.slice(dot + 1).toLowerCase()];
}

/** Languages that describe a codebase, not just its config or docs. */
const NON_PROGRAMMING = new Set(["yaml", "json", "markdown", "css", "html", "shell", "sql"]);

/** Programming languages present in a file list, most common first. */
export function detectLanguages(files: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = languageOf(file);
    if (language && !NON_PROGRAMMING.has(language))
      counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([l]) => l);
}
