#!/usr/bin/env bun
import { projectRulePublic } from "@tripwire/core";
import { createDb, schema } from "@tripwire/db";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

/**
 * ONE-SHOT backfill (§10) — NOT scheduled. Run once by hand after the public
 * projection shipped; historical rule steps predate it and stored null
 * `public_evidence` / `summary`, so a blocked run showed no reason.
 *
 * This re-projects each historical rule step's STORED evidence through the SAME
 * `projectRulePublic` the worker uses at write time (no second home for rule
 * knowledge — the §10 invariant). Append-only is respected: raw events are never
 * touched; only the derived projection columns on `run_steps` are filled in.
 * Idempotent — re-running projects the same evidence to the same values.
 *
 *   bun run scripts/backfill-public-projection.ts          # apply
 *   bun run scripts/backfill-public-projection.ts --dry    # count only
 */

const DRY = process.argv.includes("--dry");
const { runSteps } = schema;
const { db, pool } = createDb();

// Rule steps that HAVE evidence but no projection yet — the backfill target.
const stale = await db
	.select({
		id: runSteps.id,
		ruleId: runSteps.ruleId,
		evidence: runSteps.evidence,
	})
	.from(runSteps)
	.where(
		and(
			eq(runSteps.nodeKind, "rule"),
			isNotNull(runSteps.ruleId),
			isNotNull(runSteps.evidence),
			or(isNull(runSteps.publicEvidence), isNull(runSteps.summary)),
		),
	);

let updated = 0;
let skipped = 0;
for (const step of stale) {
	if (!step.ruleId) {
		continue;
	}
	// Historical evidence predates the current rule shape — a summarize that
	// assumes a field can throw. Degrade honestly: skip + count, never crash the
	// whole backfill on one malformed row.
	// run_steps.evidence stores the RuleResult envelope; the projection wants the
	// inner typed evidence — unwrap exactly like the worker's withPublicProjection.
	const envelope = step.evidence;
	const inner =
		envelope && typeof envelope === "object" && "evidence" in envelope
			? (envelope as { evidence: unknown }).evidence
			: envelope;
	let projection: { publicEvidence: unknown; summary: string | null };
	try {
		projection = projectRulePublic(step.ruleId, inner);
	} catch (err) {
		skipped += 1;
		console.warn(
			`skip step ${step.id} (${step.ruleId}): ${err instanceof Error ? err.message : err}`,
		);
		continue;
	}
	const { publicEvidence, summary } = projection;
	// Nothing to write if the rule opts out / evidence yields no projection.
	if (publicEvidence === null && summary === null) {
		continue;
	}
	if (!DRY) {
		await db
			.update(runSteps)
			.set({ publicEvidence, summary })
			.where(eq(runSteps.id, step.id));
	}
	updated += 1;
}

console.log(
	`${DRY ? "[dry] would backfill" : "backfilled"} ${updated} of ${stale.length} stale rule step(s)${skipped ? `, skipped ${skipped} on shape mismatch` : ""}`,
);

await pool.end();
