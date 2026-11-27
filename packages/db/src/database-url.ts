/** PlanetScale's PgBouncer port; 5432 on the same host is the direct one. */
export const PLANETSCALE_POOLED_PORT = "6432";

/** The port of a production PlanetScale URL, or null when the rule doesn't apply. */
function planetScalePort(databaseUrl: string, nodeEnv: string | undefined) {
	if (nodeEnv !== "production") return null;
	let url: URL;
	try {
		url = new URL(databaseUrl);
	} catch {
		return null;
	}
	if (!url.hostname.endsWith(".psdb.cloud")) return null;
	return url.port || "5432";
}

/**
 * Refuses to start a production app whose `DATABASE_URL` is PlanetScale's
 * direct port. Every process then holds its own connections, and the smallest
 * PlanetScale size allows 22: on 2026-11-27 prod ran out and went down. Throws
 * at boot, so Unkey's health check fails the deploy while the previous one
 * keeps serving.
 *
 * `apps/web/instrument.server.mjs` repeats this rule; keep them the same.
 */
export function assertPooledDatabaseUrl(
	databaseUrl: string,
	nodeEnv = process.env.NODE_ENV,
): void {
	const port = planetScalePort(databaseUrl, nodeEnv);
	if (port === null || port === PLANETSCALE_POOLED_PORT) return;
	throw new Error(
		`DATABASE_URL uses PlanetScale's direct port ${port}. Use the pooled port ${PLANETSCALE_POOLED_PORT}, and put the direct URL in DATABASE_URL_DIRECT.`,
	);
}

/**
 * The other half: LISTEN needs a session, which the pooler drops without an
 * error, so the live feed would silently stop. `createDirectPool` falls back
 * to `DATABASE_URL` when `DATABASE_URL_DIRECT` is unset, which in production
 * is now the pooled one.
 */
export function assertSessionDatabaseUrl(
	databaseUrl: string,
	nodeEnv = process.env.NODE_ENV,
): void {
	if (planetScalePort(databaseUrl, nodeEnv) !== PLANETSCALE_POOLED_PORT) return;
	throw new Error(
		"DATABASE_URL_DIRECT is unset or uses PlanetScale's pooled port 6432; LISTEN needs the direct port 5432.",
	);
}
