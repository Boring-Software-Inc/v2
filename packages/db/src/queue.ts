import { GITCAFE_CONNECT_QUEUE } from "@tripwire/contracts";
import { type ConstructorOptions, PgBoss, type WorkOptions } from "pg-boss";

/** Keeps queue maintenance inside the smallest supported database connection budget. */
export const QUEUE_POOL_MAX = 4;

/**
 * Without this a worker sleeps the 2 s polling interval after every job, even
 * with thousands queued: a 0.05 s job cost 2.05 s, capping one worker at about
 * 1,800 jobs an hour. Burst fetches the next job immediately while the queue's
 * ready count (refreshed by pg-boss every minute) is above 1, and falls back to
 * polling once a fetch comes back short. One job in flight per worker, so FIFO
 * order is unchanged.
 */
export const DRAIN_BACKLOG_WORK_OPTIONS = {
	burstWhenReadyExceeds: 1,
} satisfies WorkOptions;

/** pg-boss emits a `queue_backlog` warning once a queue holds more than this. */
export const QUEUE_BACKLOG_WARNING_SIZE = 500;

export function queueDatabaseOptions(
	databaseUrl: string,
): Pick<ConstructorOptions, "connectionString" | "max"> {
	return { connectionString: databaseUrl, max: QUEUE_POOL_MAX };
}

/** Ingest → worker handoff (§5). */
export const PROCESS_EVENT_QUEUE = "process-event";

export interface ProcessEventJob {
	eventId: string;
}

/** Moderation decision → worker resume (§6). */
export const RESUME_RUN_QUEUE = "resume-run";
export const RESTORE_CONTRIBUTION_APPEAL_QUEUE = "restore-contribution-appeal";

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

/** Arming → arm-time backfill (§4): replay stored events into real runs. */
export const BACKFILL_REPO_QUEUE = "backfill-repo";

export interface BackfillRepoJob {
	repoId: string;
}

export const SYNC_REPO_REVIEWERS_QUEUE = "sync-repo-reviewers";

export interface SyncRepoReviewersJob {
	repoId: string;
}

export function syncRepoReviewersOptions(repoId: string) {
	return { singletonKey: repoId };
}

export const SYNC_REPO_LABELS_QUEUE = "sync-repo-labels";

export interface SyncRepoLabelsJob {
	repoId: string;
}

export function syncRepoLabelsOptions(repoId: string) {
	return { singletonKey: repoId };
}

export const SYNC_REPO_BRANCHES_QUEUE = "sync-repo-branches";

export interface SyncRepoBranchesJob {
	repoId: string;
}

export function syncRepoBranchesOptions(repoId: string) {
	return { singletonKey: repoId };
}

export const RULE_PREVIEW_QUEUE = "rule-preview";

export interface RulePreviewJob {
	repoId: string;
}

export function rulePreviewOptions(repoId: string) {
	return { singletonKey: repoId };
}

export const RECOVER_INSTALLATION_QUEUE = "recover-installation";

export interface RecoverInstallationJob {
	userId: string;
	installationId: string;
}

export function recoverInstallationOptions(job: RecoverInstallationJob) {
	return { singletonKey: `${job.userId}:${job.installationId}` };
}

export const SYNC_FLAG_OVERRIDES_QUEUE = "sync-flag-overrides";

export interface SyncFlagOverridesJob {
	flagKey: string;
}

export function syncFlagOverridesOptions(flagKey: string) {
	return {
		singletonKey: flagKey,
		retryLimit: 5,
		retryDelay: 15,
		retryBackoff: true,
	};
}

export const REFRESH_SURFACES_QUEUE = "refresh-response-surfaces";

export interface RefreshSurfacesJob {
	repoId: string;
}

/** Minimal logger surface — satisfied by pino, console, etc. */
export interface BossErrorLogger {
	error(obj: { error: Error | string }, msg?: string): void;
	warn?(obj: { warning: unknown }, msg?: string): void;
}

/** Connection producers and the isolated worker must leave general backlog maintenance stopped. */
export async function createGitCafeConnectionBoss(
	databaseUrl: string,
	logger: BossErrorLogger,
): Promise<PgBoss> {
	const boss = new PgBoss({
		...queueDatabaseOptions(databaseUrl),
		schedule: false,
		supervise: false,
		migrate: false,
		createSchema: false,
	});
	boss.on("error", () =>
		logger.error(
			{ error: "queue-unavailable" },
			"GitCafe connection queue unavailable",
		),
	);
	try {
		await boss.start();
		await boss.createQueue(GITCAFE_CONNECT_QUEUE);
		return boss;
	} catch (error) {
		await boss.stop({ graceful: false }).catch(() => undefined);
		throw error;
	}
}

/**
 * One PgBoss per process. `start()` installs the pgboss schema and runs
 * maintenance; `createQueue` is idempotent. The api head only sends (inside
 * the ingest transaction); the worker heads consume.
 *
 * A pg-boss `error` event is an EventEmitter 'error' — with no listener Node
 * rethrows it as `ERR_UNHANDLED_ERROR` and the process dies. That is exactly
 * how a transient DB condition (e.g. Postgres flipping read-only, code 25006,
 * when the volume fills) turns a recoverable blip into a crash-loop: pg-boss
 * maintenance fails → unhandled error → process exit → restart → repeat. We
 * always attach a handler so the process stays up, retries, and recovers on
 * its own when the DB returns to read-write.
 */
export async function createBoss(
	databaseUrl = process.env.DATABASE_URL,
	logger?: BossErrorLogger,
): Promise<PgBoss> {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not set");
	}
	const boss = new PgBoss({
		...queueDatabaseOptions(databaseUrl),
		warningQueueSize: QUEUE_BACKLOG_WARNING_SIZE,
	});
	boss.on("error", (error) => {
		if (logger) {
			logger.error({ error }, "pg-boss error (queue maintenance/fetch)");
		} else {
			console.error("pg-boss error (queue maintenance/fetch):", error);
		}
	});
	boss.on("warning", (warning) => {
		if (logger?.warn) {
			logger.warn({ warning }, "pg-boss warning (backlog or slow query)");
		} else {
			console.warn("pg-boss warning (backlog or slow query):", warning);
		}
	});
	await boss.start();
	await boss.createQueue(PROCESS_EVENT_QUEUE);
	await boss.createQueue(RESUME_RUN_QUEUE);
	await boss.createQueue(RESTORE_CONTRIBUTION_APPEAL_QUEUE, {
		retryLimit: 10,
		retryDelay: 15,
		retryBackoff: true,
	});
	await boss.createQueue(BACKFILL_REPO_QUEUE);
	await boss.createQueue(RERUN_QUEUE);
	await boss.createQueue(SYNC_REPO_REVIEWERS_QUEUE, { policy: "stately" });
	await boss.createQueue(SYNC_REPO_LABELS_QUEUE, { policy: "stately" });
	await boss.createQueue(SYNC_REPO_BRANCHES_QUEUE, { policy: "stately" });
	await boss.createQueue(REFRESH_SURFACES_QUEUE);
	await boss.createQueue(SYNC_FLAG_OVERRIDES_QUEUE, { policy: "stately" });
	await boss.createQueue(RECOVER_INSTALLATION_QUEUE, { policy: "stately" });
	await boss.createQueue(RULE_PREVIEW_QUEUE, { policy: "stately" });
	return boss;
}
