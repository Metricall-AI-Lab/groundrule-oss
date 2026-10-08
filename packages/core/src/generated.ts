/**
 * Content Groundrule generates for coding agents. It repeats the standards' own
 * examples (including forbidden code), so it must never be evaluated.
 */
export const MANAGED_BEGIN = "<!-- groundrule:begin -->";
export const MANAGED_END = "<!-- groundrule:end -->";

/** Files Groundrule owns entirely. */
const GENERATED_FILES = [
  /^\.cursor\/rules\/groundrule(-[a-z0-9-]+)?\.mdc$/,
  /^\.github\/instructions\/groundrule-[a-z0-9-]+\.instructions\.md$/,
];

export function isGeneratedFile(path: string): boolean {
  return GENERATED_FILES.some((re) => re.test(path));
}

/** Blank out managed blocks, keeping line numbers intact for everything else. */
export function stripManagedBlocks(text: string): string {
  if (!text.includes(MANAGED_BEGIN)) return text;
  const lines = text.split("\n");
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes(MANAGED_BEGIN)) inside = true;
    if (inside) lines[i] = "";
    if (line.includes(MANAGED_END)) inside = false;
  }
  return lines.join("\n");
}

const GROUNDRULE_DOCUMENT = /^apiVersion:\s*["']?groundrule\.dev\//m;

/**
 * Groundrule documents (standards, packs, configs) contain examples of forbidden code,
 * wherever they live, e.g. an organization's shared standards repository.
 */
export function isGroundruleDocument(path: string, text: string): boolean {
  return /\.ya?ml$/.test(path) && GROUNDRULE_DOCUMENT.test(text);
}
