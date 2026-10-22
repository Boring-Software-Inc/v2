import type { Auth } from "@tripwire/auth/server";
import { type Db, orgServices, resetDemoData } from "@tripwire/db";
import { z } from "zod";
import {
	DEV_LATENCY_COOKIE,
	type DevScenario,
	devLatencyMs,
	devScenarioSchema,
	getPreset,
	normalizeScenario,
} from "#/lib/dev/scenarios";
import { applyScenario } from "./apply-scenario.ts";
import { assertDevLoginAllowed } from "./guard.ts";

const scenarioBodySchema = z.object({
	scenario: devScenarioSchema,
	latency: z.number().int().min(0).optional(),
});

const loginBodySchema = z.object({ persona: z.string() });

function json<T extends object>(body: T, status = 200): Response {
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

function latencyCookie(latency: number): string {
	const ms = devLatencyMs(String(latency));
	return ms > 0
		? `${DEV_LATENCY_COOKIE}=${ms}; Path=/; SameSite=Lax`
		: `${DEV_LATENCY_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

async function signOut(auth: Auth, request: Request): Promise<Response | null> {
	return await auth.api
		.signOut({ headers: request.headers, asResponse: true })
		.catch(() => null);
}

async function readBody(request: Request): Promise<object | null> {
	return await request.json().catch(() => null);
}

async function runScenario(input: {
	db: Db;
	auth: Auth;
	request: Request;
	scenario: DevScenario;
	latency: number | undefined;
}): Promise<Response> {
	const scenario = normalizeScenario(input.scenario);
	const signedOut =
		scenario.account === "anonymous"
			? await signOut(input.auth, input.request)
			: null;
	try {
		const applied = await applyScenario({
			db: input.db,
			auth: input.auth,
			scenario,
			now: new Date(),
		});
		const res = json({ landing: applied.landing });
		for (const source of [signedOut, applied.session]) {
			if (source) {
				copySetCookies(source, res);
			}
		}
		if (input.latency !== undefined) {
			res.headers.append("set-cookie", latencyCookie(input.latency));
		}
		return res;
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "could not apply scenario";
		return json({ error: message }, 500);
	}
}

async function whoami(db: Db, auth: Auth, request: Request): Promise<Response> {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) {
		return json({ signedIn: false });
	}
	const orgs = await orgServices.listUserOrgs(db, session.user.id);
	return json({
		signedIn: true,
		email: session.user.email,
		name: session.user.name,
		orgs: orgs.map((org) => ({
			slug: org.slug,
			name: org.name,
			role: org.role,
		})),
	});
}

export async function handleDevRequest(request: Request): Promise<Response> {
	assertDevLoginAllowed({
		isDev: import.meta.env.DEV,
		host: request.headers.get("host"),
	});

	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		return json(
			{
				error:
					"Sign-in is turned off. Set BETTER_AUTH_SECRET to use dev scenarios.",
			},
			503,
		);
	}
	const { getDb } = await import("#/lib/server/db");
	const { db } = getDb();
	const { pathname } = new URL(request.url);

	if (pathname === "/api/dev/whoami") {
		return await whoami(db, auth, request);
	}
	if (request.method !== "POST") {
		return json({ error: "not found" }, 404);
	}

	if (pathname === "/api/dev/reset" || pathname === "/api/dev/logout") {
		const out = await signOut(auth, request);
		if (pathname === "/api/dev/reset") {
			await resetDemoData(db);
		}
		const res = json({ ok: true });
		if (out) {
			copySetCookies(out, res);
		}
		return res;
	}

	if (pathname === "/api/dev/scenario") {
		const body = scenarioBodySchema.safeParse(await readBody(request));
		if (!body.success) {
			return json(
				{ error: body.error.issues[0]?.message ?? "invalid scenario" },
				400,
			);
		}
		return await runScenario({
			db,
			auth,
			request,
			scenario: body.data.scenario,
			latency: body.data.latency,
		});
	}

	if (pathname === "/api/dev/login") {
		const body = loginBodySchema.safeParse(await readBody(request));
		const preset = body.success ? getPreset(body.data.persona) : undefined;
		if (!preset) {
			return json(
				{
					error: `unknown persona: ${body.success ? body.data.persona : "missing"}`,
				},
				400,
			);
		}
		return await runScenario({
			db,
			auth,
			request,
			scenario: preset.scenario,
			latency: preset.latency,
		});
	}

	return json({ error: "not found" }, 404);
}
