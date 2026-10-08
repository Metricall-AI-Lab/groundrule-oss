export type { ReportInput } from "./input.js";
export { renderJson } from "./json.js";
export { renderMarkdown } from "./markdown.js";
export { renderSarif } from "./sarif.js";
export { colorEnabled, createStyle, type Style } from "./style.js";
export { renderTerminal, type TerminalOptions } from "./terminal.js";

export const FORMATS = ["terminal", "json", "sarif", "markdown"] as const;
export type Format = (typeof FORMATS)[number];
