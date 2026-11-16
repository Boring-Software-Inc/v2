import { z } from "zod";

/**
 * Forge-derived values — GitHub controls this set, not tripwire. Stays closed
 * while mocks drive the UI; needs a passthrough/catch variant when real ingest
 * lands (build step 3/4). Do not widen before then.
 */
export const threadKindSchema = z.enum(["issue", "pull"]);
export type ThreadKind = z.infer<typeof threadKindSchema>;

/**
 * Forge-derived values — GitHub controls this set, not tripwire. Stays closed
 * while mocks drive the UI; needs a passthrough/catch variant when real ingest
 * lands (build step 3/4). Do not widen before then.
 */
export const threadStatusSchema = z.enum(["open", "closed", "merged"]);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
