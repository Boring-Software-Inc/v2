import type { Auth } from "@tripwire/auth/server";
import type { GitCafeReceiptConfig } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { IngestDropTally } from "./ingest-drops.ts";
import type { QueueAlertsSnapshot } from "./queue-alerts.ts";

/** Dependencies injected into every route via context — testable by design. */
export interface ApiDeps {
	/**
	 * Session validation for browser-facing endpoints (SSE). null ⇒ dev open
	 * posture (no BETTER_AUTH_SECRET); production refuses to boot instead
	 * (resolveAuthPosture).
	 */
	auth: Auth | null;
	db: Db;
	pool: Pool;
	/**
	 * Direct/session pool for the SSE `LISTEN`. A transaction-pooled connection
	 * can't hold a LISTEN through PlanetScale's pooler, so this uses
	 * `DATABASE_URL_DIRECT` (falling back to `DATABASE_URL` locally).
	 */
	directPool: Pool;
	boss: PgBoss;
	/** Queue backlog alerts (`/healthz/queues`); absent in tests. */
	queueAlerts?: { snapshot(): QueueAlertsSnapshot };
	/** Counts webhooks acknowledged without storing; absent in tests. */
	ingestDrops?: IngestDropTally;
	webhookSecret: string;
	gitCafeReceipts?: GitCafeReceiptConfig | null;
	/** Allowed CORS origin for the SSE stream (the web dashboard). */
	webOrigin: string;
	logger: Logger;
}

export interface ApiEnv {
	Variables: {
		deps: ApiDeps;
		requestId: string;
		failureCaptured: boolean;
		/**
		 * Repo fullNames the SSE caller may see through org membership; null ⇒
		 * unrestricted (dev open posture). Set by the stream's session gate.
		 */
		visibleRepos: Set<string> | null;
		/** The signed-in viewer; null in dev open posture. */
		viewerId: string | null;
	};
}
