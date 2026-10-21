import {
	createDb,
	DEMO_EMAIL_DOMAIN,
	orgServices,
	seedRollups,
	user,
} from "@tripwire/db";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const PERSONAS = ["active", "one-repo", "many-repos", "empty", "fresh"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const databaseUrl = process.env.DATABASE_URL ?? "";
const host = URL.canParse(databaseUrl) ? new URL(databaseUrl).hostname : "";
if (!LOCAL_HOSTS.has(host)) {
	console.error(
		`refusing to seed ${host || "an unset DATABASE_URL"}: bun run seed only writes to a database on this machine`,
	);
	process.exit(2);
}

async function ensurePersona(persona: string): Promise<void> {
	const res = await fetch(`${BASE_URL}/api/dev/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ persona }),
	}).catch(() => null);
	if (!res?.ok) {
		throw new Error(
			`could not create the ${persona} persona at ${BASE_URL}. Start the dev server with BETTER_AUTH_SECRET set, then run bun run seed again.`,
		);
	}
}

const { db, pool } = createDb(databaseUrl);

async function userIdFor(persona: string): Promise<string> {
	const [row] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, `${persona}@${DEMO_EMAIL_DOMAIN}`));
	if (!row) {
		throw new Error(`the ${persona} persona has no user row after login`);
	}
	return row.id;
}

try {
	const now = new Date();
	for (const persona of PERSONAS) {
		await ensurePersona(persona);
	}
	console.log(`personas: ${PERSONAS.join(", ")}`);

	const activeUserId = await userIdFor("active");
	const [activeOrg] = await orgServices.listUserOrgs(db, activeUserId);
	if (!activeOrg) {
		throw new Error("the active persona has no org");
	}

	await seedRollups(db, { now, days: 365 });
	console.log("daily rollups: 365 days");

	console.log(
		`done. Sign in as the active persona to see ${BASE_URL}/${activeOrg.slug}/active-webapp`,
	);
} finally {
	await pool.end();
}
