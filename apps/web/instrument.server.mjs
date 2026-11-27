import { init } from "@sentry/node";

/**
 * The web head opens its pool on the first request, so the pooled-URL rule
 * in `packages/db/src/database-url.ts` runs here too, at boot: a direct-port
 * DATABASE_URL then fails Unkey's health check instead of every page.
 */
function assertPooledDatabaseUrl() {
	const value = process.env.DATABASE_URL;
	if (process.env.NODE_ENV !== "production" || !value) return;
	let url;
	try {
		url = new URL(value);
	} catch {
		return;
	}
	if (!url.hostname.endsWith(".psdb.cloud") || url.port === "6432") return;
	throw new Error(
		`DATABASE_URL uses PlanetScale's direct port ${url.port || "5432"}. Use the pooled port 6432.`,
	);
}

assertPooledDatabaseUrl();

init({
	dsn: process.env.SENTRY_DSN,
	environment: process.env.UNKEY_ENVIRONMENT_SLUG || process.env.NODE_ENV,
	release: process.env.UNKEY_GIT_COMMIT_SHA || undefined,
	tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
	dataCollection: {
		userInfo: false,
		cookies: false,
		httpHeaders: { allow: ["user-agent", "content-type", "accept"] },
		httpBodies: [],
		urlQueryParams: false,
		databaseQueryData: false,
		queues: false,
		stackFrameVariables: false,
		genAI: { inputs: false, outputs: false },
	},
});
