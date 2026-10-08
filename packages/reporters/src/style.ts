/** Minimal ANSI styling that respects NO_COLOR, FORCE_COLOR, and TTY detection. */
export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  blue(s: string): string;
  magenta(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

export function colorEnabled(
  stream: { isTTY?: boolean } = process.stdout,
  env = process.env,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  return Boolean(stream.isTTY) && env.TERM !== "dumb";
}

export function createStyle(enabled: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}
