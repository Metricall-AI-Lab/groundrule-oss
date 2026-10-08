import { readFileSync } from "node:fs";
import { colorEnabled, createStyle, type Style } from "@groundrule/reporters";

/** Everything a command touches outside itself, so commands are testable. */
export interface IO {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: { write(text: string): void; isTTY?: boolean };
  stderr: { write(text: string): void; isTTY?: boolean };
  /** Network access to the Groundrule platform. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Open a URL in the browser; resolves false if it couldn't. */
  openUrl?: (url: string) => Promise<boolean>;
  /** Wait between polls. */
  sleep?: (ms: number) => Promise<void>;
  /** Shown to the person approving `groundrule login`. Defaults to the OS hostname. */
  hostname?: string;
  /** Where credentials live. Defaults to $XDG_CONFIG_HOME/groundrule or ~/.config/groundrule. */
  configDir?: string;
}

export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

export function style(io: IO, stream: "stdout" | "stderr" = "stdout"): Style {
  return createStyle(colorEnabled(io[stream], io.env));
}

export function println(io: IO, text = "") {
  io.stdout.write(`${text}\n`);
}

export function eprintln(io: IO, text = "") {
  io.stderr.write(`${text}\n`);
}

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
