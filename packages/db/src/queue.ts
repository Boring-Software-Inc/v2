import { PgBoss } from "pg-boss";

/** Ingest → worker handoff (§5). */
export const PROCESS_EVENT_QUEUE = "process-event";

export interface ProcessEventJob {
	eventId: string;
}

/** Moderation decision → worker resume (§6). */
export const RESUME_RUN_QUEUE = "resume-run";

export interface ResumeRunJob {
	itemId: string;
	decision: "approve" | "deny";
}

/**
 * Manual re-run (org-admin action) → worker re-evaluation under the CURRENT
 * enabled workflow, as a NEW run, delivered through the normal amendment path.
 * Enqueued with `singletonKey` + `singletonSeconds` — one re-run per change
 * request per cooldown window; a deduped send returns null and the server fn
 * surfaces the cooldown. Duration is env-driven; per-user exempt is a staff
 * flag on `user.rerun_cooldown_exempt`.
 */
export const RERUN_QUEUE = "rerun-change-request";

/** Fallback when `RERUN_COOLDOWN_SECONDS` is unset or invalid. */
export const DEFAULT_RERUN_COOLDOWN_SECONDS = 300;

/**
 * Global re-run cooldown window (seconds). Read from `RERUN_COOLDOWN_SECONDS`
 * at call time so a process restart (or dotenv reload) picks up changes
 * without a code deploy of the constant. Floor 0; non-finite → default.
 */
export function getRerunCooldownSeconds(): number {
	const raw = process.env.RERUN_COOLDOWN_SECONDS;
	if (raw == null || raw === "") {
		return DEFAULT_RERUN_COOLDOWN_SECONDS;
	}
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) {
		return DEFAULT_RERUN_COOLDOWN_SECONDS;
	}
	return Math.floor(n);
}

/**
 * @deprecated Prefer `getRerunCooldownSeconds()`. Kept as an alias for tests
 * that still import the name; evaluates the env at module load only.
 */
export const RERUN_COOLDOWN_SECONDS = getRerunCooldownSeconds();

export interface RerunChangeRequestJob {
	repoFullName: string;
	number: number;
	/** The admin who triggered it — lands on runs.triggered_by. */
	requestedBy: string;
	/**
	 * Pre-materialized run id (created at enqueue in `queued` status). The
	 * worker claims and finalizes this row; missing only for legacy jobs.
	 */
	runId?: string;
}

/** Arming → arm-time backfill (§4): replay stored events into real runs. */
export const BACKFILL_REPO_QUEUE = "backfill-repo";

export interface BackfillRepoJob {
	repoId: string;
}

/**
 * One PgBoss per process. `start()` installs the pgboss schema and runs
 * maintenance; `createQueue` is idempotent. The api head only sends (inside
 * the ingest transaction); the worker heads consume.
 */
export async function createBoss(
	databaseUrl = process.env.DATABASE_URL,
): Promise<PgBoss> {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not set");
	}
	const boss = new PgBoss({ connectionString: databaseUrl });
	await boss.start();
	await boss.createQueue(PROCESS_EVENT_QUEUE);
	await boss.createQueue(RESUME_RUN_QUEUE);
	await boss.createQueue(BACKFILL_REPO_QUEUE);
	await boss.createQueue(RERUN_QUEUE);
	return boss;
}
