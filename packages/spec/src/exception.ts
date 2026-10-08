import { z } from "zod";
import { ApiVersion, Glob, IsoDate, StandardId } from "./common.js";

export const ExceptionEntry = z.strictObject({
  id: z
    .string()
    .regex(/^EX-[0-9]+$/, "Exception IDs look like EX-1042")
    .describe("Unique exception identifier."),
  standard: StandardId,
  paths: z.array(Glob).min(1).default(["**"]).describe("Where the exception applies."),
  reason: z.string().min(1),
  requestedBy: z.string().min(1).optional(),
  approvedBy: z.string().min(1).optional(),
  expires: IsoDate.describe("After this date the exception no longer applies."),
  remediation: z.string().min(1).optional().describe("Plan to remove the need for the exception."),
});
export type ExceptionEntry = z.infer<typeof ExceptionEntry>;

export const ExceptionList = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("ExceptionList"),
    spec: z.strictObject({
      exceptions: z.array(ExceptionEntry).default([]),
    }),
  })
  .describe("Time-boxed exceptions, stored at .groundrule/exceptions.yaml.");
export type ExceptionList = z.infer<typeof ExceptionList>;

/** An exception is active through the end of its expiry date (UTC). */
export function isExceptionActive(
  entry: Pick<ExceptionEntry, "expires">,
  now = new Date(),
): boolean {
  return now.toISOString().slice(0, 10) <= entry.expires;
}
