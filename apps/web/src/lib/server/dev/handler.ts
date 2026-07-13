import {
	type Db,
	DEMO_EMAIL_DOMAIN,
	ensureDemoRepo,
	onboardingServices,
	resetDemoData,
	schema,
	seedPublicRun,
	seedStory,
} from "@tripwire/db";
import { eq } from "drizzle-orm";
import { getPersona, type PersonaId } from "#/lib/dev/personas";
import { assertDevLoginAllowed } from "./guard.ts";

/**
 * DEV persona endpoint (§13) — mounted at `/api/dev/*` by start.ts ONLY in a
 * dev build (`import.meta.env.DEV`), and refused for any non-loopback host. It
 * mints a REAL better-auth session (via email/password, bypassing OAuth — never
 * session verification) and auto-creates each persona's fixtures on demand
 * (spatie's create-missing-users, adapted to Tripwire's product states).
 */

/** A fixed, well-known dev password — these accounts only exist locally. */
const DEV_PASSWORD = "tripwire-dev-persona";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function copySetCookies(from: Response, to: Response): void {
	for (const cookie of from.headers.getSetCookie()) {
		to.headers.append("set-cookie", cookie);
	}
}

type Auth = NonNullable<ReturnType<typeof import("#/lib/server/auth").getAuth>>;

/**
 * Ensure the persona's user exists and return a Response carrying its session
 * cookie. Tries sign-in first; falls back to sign-up (create-missing-users).
 */
async function mintSession(
	auth: Auth,
	email: string,
	name: string,
): Promise<Response> {
	// With `asResponse`, a missing user is a non-ok 401 (not a throw), so check
	// `ok` before falling back to sign-up — the returning path (user exists)
	// short-circuits here.
	try {
		const signIn = await auth.api.signInEmail({
			body: { email, password: DEV_PASSWORD },
			asResponse: true,
		});
		if (signIn.ok) {
			return signIn;
		}
	} catch {
		// fall through to sign-up
	}
	return await auth.api.signUpEmail({
		body: { email, password: DEV_PASSWORD, name },
		asResponse: true,
	});
}

async function setupPersona(
	db: Db,
	persona: PersonaId,
	userId: string,
	now: Date,
): Promise<void> {
	const link = (installationId: string) =>
		onboardingServices.linkUserInstallation(db, { userId, installationId });

	if (persona === "fresh") {
		return; // no installation — lands on onboarding's install step
	}
	if (persona === "one-repo") {
		await link("demo-inst-one");
		await ensureDemoRepo(db, "solo-webapp", {
			installationId: "demo-inst-one",
		});
		return;
	}
	if (persona === "many-repos") {
		await link("demo-inst-many");
		for (const name of ["many-api", "many-web", "many-docs", "many-infra"]) {
			await ensureDemoRepo(db, name, { installationId: "demo-inst-many" });
		}
		return;
	}
	if (persona === "empty") {
		await link("demo-inst-empty");
		const repo = await ensureDemoRepo(db, "empty-repo", {
			installationId: "demo-inst-empty",
		});
		await onboardingServices.setActiveRepo(db, userId, repo.id);
		return;
	}
	if (persona === "active") {
		await link("demo-inst-active");
		const repo = await ensureDemoRepo(db, "active-webapp", {
			installationId: "demo-inst-active",
		});
		await onboardingServices.setActiveRepo(db, userId, repo.id);
		await seedStory(db, repo, now);
	}
}

/** Handle a `/api/dev/*` request. Assumes the caller already confirmed DEV. */
export async function handleDevRequest(request: Request): Promise<Response> {
	assertDevLoginAllowed({
		isDev: import.meta.env.DEV,
		host: request.headers.get("host"),
	});

	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		return json(
			{ error: "auth disabled — set BETTER_AUTH_SECRET to use the switcher" },
			503,
		);
	}
	const { getDb } = await import("#/lib/server/db");
	const { db } = getDb();
	const url = new URL(request.url);
	const now = new Date();

	if (url.pathname === "/api/dev/reset") {
		await resetDemoData(db);
		const out = await auth.api.signOut({
			headers: request.headers,
			asResponse: true,
		});
		const res = json({ ok: true });
		copySetCookies(out, res);
		return res;
	}

	if (url.pathname === "/api/dev/logout") {
		const out = await auth.api.signOut({
			headers: request.headers,
			asResponse: true,
		});
		const res = json({ ok: true });
		copySetCookies(out, res);
		return res;
	}

	if (url.pathname === "/api/dev/login") {
		const body = (await request.json().catch(() => ({}))) as {
			persona?: string;
		};
		const persona = getPersona(body.persona ?? "");
		if (!persona) {
			return json({ error: `unknown persona: ${body.persona}` }, 400);
		}

		// Persona 6 — the stranger: sign OUT and open a seeded public run.
		if (persona.id === "anonymous") {
			const pub = await ensureDemoRepo(db, "public-oss", { private: false });
			const runId = await seedPublicRun(db, pub, now);
			const out = await auth.api
				.signOut({ headers: request.headers, asResponse: true })
				.catch(() => null);
			const res = json({ landing: `/runs/${runId}` });
			if (out) {
				copySetCookies(out, res);
			}
			return res;
		}

		const email = `${persona.id}@${DEMO_EMAIL_DOMAIN}`;
		const authRes = await mintSession(auth, email, persona.label);
		const rows = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(eq(schema.user.email, email));
		const userId = rows[0]?.id;
		if (!userId) {
			return json({ error: "failed to establish dev session" }, 500);
		}
		await setupPersona(db, persona.id, userId, now);
		const res = json({ landing: persona.landing });
		copySetCookies(authRes, res);
		return res;
	}

	return json({ error: "not found" }, 404);
}
