// The contributor digest (RFC 0014): one salted SHA-256 per distinct commit author in the
// last 90 days, so the workspace can count active contributors without any address.
import { z } from "zod";

export const ContributorDigest = z
  .strictObject({
    since: z.iso
      .datetime({ offset: true })
      .describe("Start of the window: 90 days before the run."),
    complete: z.boolean().describe("false when the clone is shallow, so history may be missing."),
    digests: z
      .array(z.string().regex(/^[0-9a-f]{64}$/))
      .max(5000)
      .describe('SHA-256 of "<salt>:" + lowercased author email, hex; one per distinct author.'),
  })
  .describe("Salted hashes of commit authors (RFC 0014). Never an address, name or commit.");
export type ContributorDigest = z.infer<typeof ContributorDigest>;
