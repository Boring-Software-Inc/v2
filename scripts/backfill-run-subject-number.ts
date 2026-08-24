#!/usr/bin/env bun
import { createDb } from "@tripwire/db";

/**
 * ONE-SHOT backfill, not scheduled. Run once after the comment-subject fix.
 *
 * `runs.subject_number` used to be derived only from a change-request event, so
 * every run triggered by a COMMENT stored null even though the normalized event
 * named its change request all along (`comment.subjectNumber`). That column is
 * load-bearing in three places, which is why a read-time fallback would not do:
 *
 *   - the run page's deep link to the change request it judged
 *   - `canRerun` (§6 — a re-run needs a subject to target)
 *   - `sweep-actions`, which skips actions whose subject is null, so a recorded
 *     block or comment was never delivered and the give-up window abandoned it
 *
 * The value is recovered from the STORED normalized event, not re-derived from a
 * forge call: append-only is respected, raw events are untouched, and only this
 * derived column is filled. Idempotent, because it targets null rows only.
 *
 *   bun run scripts/backfill-run-subject-number.ts        # apply
 *   bun run scripts/backfill-run-subject-number.ts --dry  # count only
 */

const DRY = process.argv.includes("--dry");
const { pool } = createDb();

/**
 * Runs with no subject whose event DOES name one. `jsonb->>` yields text, so the
 * digit guard is deliberate rather than a permissive cast: a non-numeric value
 * is a corrupt payload to look at, not a run to silently repair.
 */
const SELECT = `
  SELECT r.id, e.normalized->'comment'->>'subjectNumber' AS subject_number
    FROM runs r
    JOIN events e ON e.id = r.event_id
   WHERE r.subject_number IS NULL
     AND e.normalized->'comment'->>'subjectNumber' ~ '^[0-9]+$'
`;

const { rows } = await pool.query<{ id: string; subject_number: string }>(
	SELECT,
);
process.stdout.write(`${rows.length} run(s) recoverable\n`);

if (DRY) {
	for (const row of rows.slice(0, 20)) {
		process.stdout.write(`  ${row.id} -> #${row.subject_number}\n`);
	}
	await pool.end();
	process.exit(0);
}

let updated = 0;
for (const row of rows) {
	const result = await pool.query(
		// The null is re-checked in the WHERE so a concurrent writer wins rather
		// than being clobbered by a stale read.
		"UPDATE runs SET subject_number = $1 WHERE id = $2 AND subject_number IS NULL",
		[Number(row.subject_number), row.id],
	);
	updated += result.rowCount ?? 0;
}
process.stdout.write(`backfilled ${updated} run(s)\n`);
await pool.end();
