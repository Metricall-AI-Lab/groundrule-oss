import picomatch from "picomatch";
import { z } from "zod";

export const Globs = z
  .array(z.string().min(1, "Patterns can't be empty"))
  .min(1, "Add at least one path pattern");

/** Files larger than this are skipped by content scanners (generated code, bundles). */
export const MAX_FILE_BYTES = 1_000_000;

export function globFilter(include?: readonly string[], exclude?: readonly string[]) {
  const inc = include?.length ? picomatch(include as string[], { dot: true }) : () => true;
  const exc = exclude?.length ? picomatch(exclude as string[], { dot: true }) : () => false;
  return (path: string) => inc(path) && !exc(path);
}

/** Read a text file, or undefined for binary or oversized files. */
export async function readText(
  read: (path: string) => Promise<string>,
  path: string,
): Promise<string | undefined> {
  let text: string;
  try {
    text = await read(path);
  } catch {
    return undefined;
  }
  if (text.length > MAX_FILE_BYTES || text.includes("\0")) return undefined;
  return text;
}

/** 1-based line number for a character offset. */
export function lineIndex(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return {
    lineAt(offset: number): number {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((starts[mid] ?? 0) <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
    line(n: number): string {
      const start = starts[n - 1] ?? 0;
      const end = starts[n] ?? text.length + 1;
      return text.slice(start, end - 1).replace(/\r$/, "");
    },
  };
}

export function truncate(text: string, max = 160): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
