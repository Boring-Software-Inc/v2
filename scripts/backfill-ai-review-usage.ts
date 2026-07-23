import { createDb, economicsServices } from "@tripwire/db";

/**
 * One-time backfill of ai_review_usage from stored run_steps traces, so the
 * admin economics page is not empty on day one. Read-only against run_steps;
 * writes only ai_review_usage rows marked backfilled with cost_usd null.
 * Idempotent: re-run is safe (unique on run_step_id).
 *
 *   bun --env-file=.env.production run scripts/backfill-ai-review-usage.ts
 */
const { db, pool } = createDb();
try {
	const result = await economicsServices.backfillAiReviewUsage(db);
	process.stdout.write(
		`backfill ai_review_usage: scanned ${result.scanned}, inserted ${result.inserted}, skipped ${result.skipped}\n`,
	);
} finally {
	await pool.end();
}
