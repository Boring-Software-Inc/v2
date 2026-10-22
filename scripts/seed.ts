import { createDb, seedRollups } from "@tripwire/db";

const BASE_URL = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const PRESET = "active";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const databaseUrl = process.env.DATABASE_URL ?? "";
const host = URL.canParse(databaseUrl) ? new URL(databaseUrl).hostname : "";
if (!LOCAL_HOSTS.has(host)) {
	console.error(
		`refusing to seed ${host || "an unset DATABASE_URL"}: bun run seed only writes to a database on this machine`,
	);
	process.exit(2);
}

async function applyPreset(preset: string): Promise<string> {
	const res = await fetch(`${BASE_URL}/api/dev/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ persona: preset }),
	}).catch(() => null);
	const body: { landing?: string } | null = await res?.json().catch(() => null);
	if (!(res?.ok && body?.landing)) {
		throw new Error(
			`could not apply the ${preset} preset at ${BASE_URL}. Start the dev server with BETTER_AUTH_SECRET set, then run bun run seed again.`,
		);
	}
	return body.landing;
}

const { db, pool } = createDb(databaseUrl);

try {
	const now = new Date();
	const landing = await applyPreset(PRESET);
	console.log(`preset: ${PRESET}`);

	await seedRollups(db, { now, days: 365 });
	console.log("daily rollups: 365 days");

	console.log(
		`done. Sign in with the ${PRESET} preset to see ${BASE_URL}${landing}`,
	);
} finally {
	await pool.end();
}
