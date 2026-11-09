import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { Auth } from "@tripwire/auth/server";
import {
	agentWorkServices,
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createApi } from "./index.ts";

/**
 * The SSE gate: dashboard data is session-gated; dev open posture (auth null)
 * keeps the stream usable; the webhook route's auth remains its HMAC. The
 * session boundary is OUR seam — better-auth's cookie internals are not under
 * test, so getSession is faked at the Auth surface.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let previousAccessGate: string | undefined;
let flagRequests = 0;
const pendingUserId = generateId();
const rejectedUserId = generateId();

function fakeAuth(session: { user: { id: string } } | null): Auth {
	return {
		api: {
			getSession: () => Promise.resolve(session),
		},
	} as unknown as Auth;
}

function makeApp(auth: Auth | null) {
	return createApi({
		auth,
		db,
		pool,
		// No pooler in the testcontainer, so the same pool holds the LISTEN.
		directPool: pool,
		boss,
		webhookSecret: "s",
		webOrigin: "http://localhost:3000",
		logger: pino({ level: "silent" }),
	});
}

beforeAll(async () => {
	previousAccessGate = process.env.ACCESS_GATE_ENABLED;
	process.env.ACCESS_GATE_ENABLED = "true";
	const originalFetch = globalThis.fetch;
	/** Synthetic flag outage exercises the real approval gate without network timing. */
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const url = new URL(
					input instanceof Request ? input.url : String(input),
				);
				const method =
					init?.method ?? (input instanceof Request ? input.method : "GET");
				if (
					url.origin === "https://api.databuddy.cc" &&
					url.pathname === "/public/v1/flags/bulk" &&
					method.toUpperCase() === "GET"
				) {
					flagRequests++;
					return Promise.resolve(new Response(null, { status: 503 }));
				}
				return originalFetch(input, init);
			},
			{ preconnect: originalFetch.preconnect },
		),
	);
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	await db.insert(schema.user).values({
		id: "u1",
		name: "approved tester",
		email: "u1@example.com",
		accessStatus: "approved",
	});
	for (const [id, accessStatus] of [
		[pendingUserId, "pending"],
		[rejectedUserId, "rejected"],
	] as const)
		await db.insert(schema.user).values({
			id,
			name: "Gate refusal",
			email: `${id}@example.test`,
			accessStatus,
		});
}, 120_000);

afterAll(async () => {
	fetchSpy?.mockRestore();
	if (previousAccessGate === undefined) delete process.env.ACCESS_GATE_ENABLED;
	else process.env.ACCESS_GATE_ENABLED = previousAccessGate;
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function firstChunk(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error("no body");
	}
	const { value } = await reader.read();
	await reader.cancel();
	return new TextDecoder().decode(value);
}

describe("GET /events/stream gate", () => {
	test("no session ⇒ 401, nothing streamed", async () => {
		const res = await makeApp(fakeAuth(null)).request("/events/stream");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "session required" });
	});

	test("valid session ⇒ 200 and the stream heartbeats", async () => {
		const res = await makeApp(fakeAuth({ user: { id: "u1" } })).request(
			"/events/stream",
		);
		expect(res.status).toBe(200);
		expect(await firstChunk(res)).toContain("event: heartbeat");
		expect(flagRequests).toBeGreaterThan(0);
	});

	for (const [status, userId] of [
		["pending", pendingUserId],
		["rejected", rejectedUserId],
	] as const)
		test(`${status} users remain forbidden when the flag service is unavailable`, async () => {
			const res = await makeApp(fakeAuth({ user: { id: userId } })).request(
				"/events/stream",
			);
			expect(res.status).toBe(403);
			expect(await res.json()).toMatchObject({ error: expect.any(String) });
		});

	test("dev open posture (auth null) ⇒ stream stays usable", async () => {
		const res = await makeApp(null).request("/events/stream");
		expect(res.status).toBe(200);
		expect(await firstChunk(res)).toContain("event: heartbeat");
	});

	test("webhook route is untouched by the gate (its auth is HMAC)", async () => {
		const res = await makeApp(fakeAuth(null)).request("/webhooks/github", {
			method: "POST",
			headers: {
				"x-github-delivery": "d",
				"x-github-event": "pull_request",
				"x-hub-signature-256": "sha256=bad",
			},
			body: "{}",
		});
		expect(res.status).toBe(401);
		const health = await makeApp(fakeAuth(null)).request("/healthz");
		expect(health.status).toBe(200);
	});
});

async function readUntil(
	res: Response,
	needle: string,
	ms: number,
): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error("no body");
	}
	const decoder = new TextDecoder();
	let seen = "";
	const deadline = Date.now() + ms;
	while (Date.now() < deadline && !seen.includes(needle)) {
		const next = await Promise.race([
			reader.read(),
			new Promise<null>((resolve) =>
				setTimeout(() => resolve(null), deadline - Date.now()),
			),
		]);
		if (!next || next.done) {
			break;
		}
		seen += decoder.decode(next.value);
	}
	await reader.cancel();
	return seen;
}

describe("GET /events/stream agent channel", () => {
	const definition = {
		id: "stream-close-stale",
		name: "Close stale PRs",
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger" as const,
				kinds: ["change-request.opened" as const],
			},
		],
		edges: [],
	};

	async function seedRepo(name: string): Promise<string> {
		const id = `repo-${name}`;
		await db.insert(schema.repos).values({
			id,
			externalId: `ext-${name}`,
			owner: "g-r-i-m",
			name,
			fullName: `g-r-i-m/${name}`,
		});
		return id;
	}

	test("a viewer who can see the repo gets each agent change as it lands", async () => {
		const repoId = await seedRepo("stream-open");
		const res = await makeApp(null).request("/events/stream");
		const reading = readUntil(res, "event: agent", 5000);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await agentWorkServices.saveAgentDraft(db, {
			repoId,
			agent: { userId: "u1", clientId: "claude-code" },
			definition,
		});
		const text = await reading;
		expect(text).toContain("event: agent");
		expect(text).toContain('"type":"work"');
		expect(text).toContain('"repoFullName":"g-r-i-m/stream-open"');
	});

	test("a user without access to the repo gets no agent events", async () => {
		const repoId = await seedRepo("stream-hidden");
		const res = await makeApp(fakeAuth({ user: { id: "u1" } })).request(
			"/events/stream",
		);
		const reading = readUntil(res, "event: agent", 1500);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await agentWorkServices.saveAgentDraft(db, {
			repoId,
			agent: { userId: "u1", clientId: "claude-code" },
			definition: { ...definition, id: "stream-hidden-wf" },
		});
		expect(await reading).not.toContain("event: agent");
	});
});

test("same-name repositories on different forges do not share live visibility", async () => {
	const { generateId } = await import("@tripwire/utils");
	const orgId = generateId();
	const ownRepoId = generateId();
	const foreignRepoId = generateId();
	const fullName = "same-owner/stream-collision";
	await db
		.insert(schema.organization)
		.values({ id: orgId, name: orgId, slug: orgId });
	await db.insert(schema.member).values({
		id: generateId(),
		organizationId: orgId,
		userId: "u1",
		role: "member",
	});
	for (const forge of ["github", "opengit"] as const) {
		await db.insert(schema.repos).values({
			id: forge === "github" ? ownRepoId : foreignRepoId,
			forge,
			externalId: generateId(),
			owner: "same-owner",
			name: "stream-collision",
			fullName,
			orgId: forge === "github" ? orgId : null,
		});
	}
	const res = await makeApp(fakeAuth({ user: { id: "u1" } })).request(
		"/events/stream",
	);
	const reading = readUntil(res, "visible-workflow", 5000);
	await new Promise((resolve) => setTimeout(resolve, 300));
	const draft = (id: string) => ({
		id,
		name: id,
		version: 1,
		nodes: [
			{
				id: "trigger",
				type: "trigger" as const,
				kinds: ["change-request.opened" as const],
			},
		],
		edges: [],
	});
	await agentWorkServices.saveAgentDraft(db, {
		repoId: foreignRepoId,
		agent: { userId: "u1", clientId: "test" },
		definition: draft("hidden-workflow"),
	});
	await agentWorkServices.saveAgentDraft(db, {
		repoId: ownRepoId,
		agent: { userId: "u1", clientId: "test" },
		definition: draft("visible-workflow"),
	});
	const text = await reading;
	expect(text).toContain("visible-workflow");
	expect(text).not.toContain("hidden-workflow");
});
