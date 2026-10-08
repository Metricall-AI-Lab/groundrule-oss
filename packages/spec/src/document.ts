import { z } from "zod";
import { Config } from "./config.js";
import { ExceptionList } from "./exception.js";
import { Pack } from "./pack.js";
import { Standard } from "./standard.js";

/** Any Groundrule YAML document, discriminated by `kind`. */
export const GroundruleDocument = z.discriminatedUnion("kind", [
  Standard,
  Pack,
  Config,
  ExceptionList,
]);
export type GroundruleDocument = z.infer<typeof GroundruleDocument>;
export type DocumentKind = GroundruleDocument["kind"];

export const DOCUMENT_SCHEMAS = {
  Standard,
  Pack,
  Config,
  ExceptionList,
} as const;
