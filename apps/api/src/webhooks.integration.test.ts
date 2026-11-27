import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { COMMENT_MARKER } from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	GITHUB_EVALUATE_QUEUE,
	organization,
	orgServices,
	PROCESS_EVENT_QUEUE,
	repoServices,
	type TestDatabase,
	workflowDefinitions,
} from "@tripwire/db";
import {
	type GithubDeliveryTarget,
	githubDeliveryActionSchema,
	githubDeliveryMustBeStored,
	normalizeWebhook,
	signWebhookBody,
} from "@tripwire/forge-github";
import { generateId } from "@tripwire/utils";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createApi } from "./index.ts";

/**
 * §11 integration layer — REAL Postgres (throwaway container). Never mock Postgres:
 * the tx + UNIQUE(delivery_id) ARE the logic under test. webhook → one tx
 * (insert + pg-boss enqueue) → row + job; same delivery-id twice ⇒ one row,
 * one job; bad signature ⇒ 401 and nothing written.
 */
const SECRET = "integration-secret";
/** The fixtures' installation, claimed by ORG_ID in beforeAll. */
const LINKED_INSTALLATION = "1";
const ORG_ID = "org-webhooks";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let app: ReturnType<typeof createApi>;

beforeAll(async () => {
	container = await createTestDatabase();
	const url = container.url;
	({ db, pool } = createDb(url));
	await applyMigrations(db);
	boss = await createBoss(url);
	await db.insert(organization).values({
		id: ORG_ID,
		name: "Webhooks fixture",
		slug: "webhooks-fixture",
	});
	await orgServices.linkOrgInstallation(db, {
		orgId: ORG_ID,
		installationId: LINKED_INSTALLATION,
	});
	app = createApi({
		auth: null,
		db,
		pool,
		directPool: pool,
		boss,
		webhookSecret: SECRET,
		webOrigin: "http://localhost:3000",
		logger: pino({ level: "silent" }),
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function deliver(body: string, deliveryId: string, sign = true) {
	const headers = new Headers({
		"x-github-delivery": deliveryId,
		"x-github-event": "pull_request",
		"content-type": "application/json",
	});
	if (sign) {
		headers.set("x-hub-signature-256", signWebhookBody(body, SECRET));
	}
	return await app.request("/webhooks/github", {
		method: "POST",
		headers,
		body,
	});
}

async function fixture(name: string): Promise<string> {
	// `fileURLToPath`, not `.pathname`: on Windows the latter yields "/C:/..."
	// with a leading slash, which no fs call accepts.
	const path = fileURLToPath(
		new URL(`../../../packages/forge-github/fixtures/${name}`, import.meta.url),
	);
	return await Bun.file(path).text();
}

/** A PR opened in `installation`, which defaults to the claimed one. */
async function fixtureBody(
	installation = LINKED_INSTALLATION,
	repo?: string,
): Promise<string> {
	const raw = JSON.parse(await fixture("pull_request.opened.json"));
	raw.installation = { id: Number(installation) };
	if (repo) raw.repository.full_name = repo;
	return JSON.stringify(raw);
}

describe("POST /webhooks/github", () => {
	test("verify → tx(insert + enqueue) → 200; row and job exist", async () => {
		const body = await fixtureBody();
		const res = await deliver(body, "delivery-aaa");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, duplicate: false });

		const rows = await pool.query(
			"SELECT id, raw_kind FROM events WHERE delivery_id = $1",
			["delivery-aaa"],
		);
		expect(rows.rowCount).toBe(1);
		expect(rows.rows[0].raw_kind).toBe("pull_request");

		const jobs = await pool.query(
			"SELECT data FROM pgboss.job WHERE name = $1",
			[PROCESS_EVENT_QUEUE],
		);
		expect(jobs.rowCount).toBe(1);
		expect(jobs.rows[0].data).toEqual({ eventId: rows.rows[0].id });
	});

	test("same delivery-id twice ⇒ still one row, one job, 200 duplicate", async () => {
		const body = await fixtureBody();
		const res = await deliver(body, "delivery-aaa");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, duplicate: true });

		const rows = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE delivery_id = $1",
			["delivery-aaa"],
		);
		expect(rows.rows[0].n).toBe(1);
		const jobs = await pool.query(
			"SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1",
			[PROCESS_EVENT_QUEUE],
		);
		expect(jobs.rows[0].n).toBe(1);
	});

	test("bad signature ⇒ 401, nothing written", async () => {
		const body = await fixtureBody();
		const res = await app.request("/webhooks/github", {
			method: "POST",
			headers: {
				"x-github-delivery": "delivery-bbb",
				"x-github-event": "pull_request",
				"x-hub-signature-256": "sha256=deadbeef",
			},
			body,
		});
		expect(res.status).toBe(401);
		const rows = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE delivery_id = $1",
			["delivery-bbb"],
		);
		expect(rows.rows[0].n).toBe(0);
	});

	test("missing signature ⇒ 401; missing headers ⇒ 400", async () => {
		const body = await fixtureBody();
		const unsigned = await deliver(body, "delivery-ccc", false);
		expect(unsigned.status).toBe(401);
		const noHeaders = await app.request("/webhooks/github", {
			method: "POST",
			body,
		});
		expect(noHeaders.status).toBe(400);
	});

	test("queue failure reports webhook correlation context and rolls back", async () => {
		const output: string[] = [];
		const failure = spyOn(boss, "insert").mockRejectedValueOnce(
			new Error("injected queue failure"),
		);
		const target = createApi({
			auth: null,
			db,
			pool,
			directPool: pool,
			boss,
			webhookSecret: SECRET,
			webOrigin: "http://localhost:3000",
			logger: pino(
				{ level: "error" },
				{ write: (chunk: string) => output.push(chunk) },
			),
		});
		try {
			const body = await fixtureBody();
			const headers = new Headers({
				"x-github-delivery": "delivery-failure",
				"x-github-event": "pull_request",
				"x-hub-signature-256": signWebhookBody(body, SECRET),
			});
			const response = await target.request("/webhooks/github", {
				method: "POST",
				headers,
				body,
			});
			expect(response.status).toBe(500);
			const requestId = response.headers.get("x-request-id");
			expect(requestId).toBeString();
			const logged = output.join("");
			expect(logged).toContain("webhook ingest failed");
			expect(logged).toContain("delivery-failure");
			expect(logged).toContain(`"requestId":"${requestId}"`);
		} finally {
			failure.mockRestore();
		}
		const rows = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE delivery_id = $1",
			["delivery-failure"],
		);
		expect(rows.rows[0].n).toBe(0);
	});
});

test("GitCafe identity alone does not enable a webhook endpoint", async () => {
	const before = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM events",
	);
	const res = await app.request("/webhooks/gitcafe", {
		method: "POST",
		body: "not a payload",
	});
	expect(res.status).toBe(404);
	const after = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM events",
	);
	expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
});

describe("ingest lanes", () => {
	let repoId: string;

	beforeAll(async () => {
		// The pull_request fixtures are scoped to Codertocat/Hello-World.
		repoId = await repoServices.ensureRepo(db, {
			externalId: "186853002",
			owner: "Codertocat",
			name: "Hello-World",
			fullName: "Codertocat/Hello-World",
			installationId: LINKED_INSTALLATION,
			orgId: ORG_ID,
		});
	});

	async function deliverAs(
		eventName: string,
		body: string,
		deliveryId: string,
	) {
		return await app.request("/webhooks/github", {
			method: "POST",
			headers: {
				"x-github-delivery": deliveryId,
				"x-github-event": eventName,
				"x-hub-signature-256": signWebhookBody(body, SECRET),
			},
			body,
		});
	}

	async function stored(deliveryId: string) {
		const rows = await pool.query<{
			id: string;
			kind: string | null;
			normalized_at: Date | null;
		}>("SELECT id, kind, normalized_at FROM events WHERE delivery_id = $1", [
			deliveryId,
		]);
		const event = rows.rows[0];
		const jobs = event
			? await pool.query<{ name: string; group_id: string | null }>(
					"SELECT name, group_id FROM pgboss.job WHERE data->>'eventId' = $1",
					[event.id],
				)
			: null;
		return { event, jobs: jobs?.rows ?? [] };
	}

	async function expectIgnored(eventName: string, body: string, id: string) {
		const res = await deliverAs(eventName, body, id);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ignored: true });
		expect((await stored(id)).event).toBeUndefined();
	}

	test("a delivery Tripwire never reads is acknowledged and not stored", async () => {
		await expectIgnored(
			"check_suite",
			JSON.stringify({ action: "requested" }),
			"lane-ignored",
		);
	});

	test("nothing is stored for an installation no org has claimed", async () => {
		await expectIgnored(
			"pull_request",
			await fixtureBody("2", "stranger/repo"),
			"lane-unclaimed",
		);
	});

	test("an edit that normalizes to nothing is not stored", async () => {
		await expectIgnored(
			"pull_request",
			await fixture("pull_request.edited.body-by-bot.json"),
			"lane-bot-edit",
		);
	});

	test("a PR on a repo with Tripwire off is stored normalized, with no job", async () => {
		await deliverAs("pull_request", await fixtureBody(), "lane-record");
		const { event, jobs } = await stored("lane-record");
		expect(event?.kind).toBe("change-request.opened");
		expect(event?.normalized_at).not.toBeNull();
		expect(jobs).toEqual([]);
	});

	test("comments and pushes on a repo with Tripwire off are not stored", async () => {
		await expectIgnored(
			"issue_comment",
			await fixture("issue_comment.created.json"),
			"lane-off-comment",
		);
		await expectIgnored("push", await fixture("push.json"), "lane-off-push");
	});

	test("a close evaluates even with Tripwire off, to settle open reviews", async () => {
		await deliverAs(
			"pull_request",
			await fixture("pull_request.closed.json"),
			"lane-close",
		);
		const { jobs } = await stored("lane-close");
		expect(jobs.map((job) => job.name)).toEqual([GITHUB_EVALUATE_QUEUE]);
	});

	test("a PR on an armed repo queues in its installation's lane", async () => {
		await repoServices.setRepoArmed(db, repoId, true);
		const body = await fixture("pull_request.synchronize.json");
		await deliverAs("pull_request", body, "lane-evaluate");
		await deliverAs(
			"pull_request",
			body.replace('"synchronize"', '"synchronize" '),
			"lane-evaluate-again",
		);
		const first = await stored("lane-evaluate");
		const second = await stored("lane-evaluate-again");
		expect(first.event?.kind).toBe("change-request.updated");
		expect(first.jobs.map((job) => job.name)).toEqual([GITHUB_EVALUATE_QUEUE]);
		expect(first.jobs[0]?.group_id).toStartWith("github:1:");
		// Same PR, same lane: its events run one at a time, in order.
		expect(second.jobs[0]?.group_id).toBe(first.jobs[0]?.group_id);
	});

	test("an armed repo's comments evaluate, but Tripwire's own are only recorded", async () => {
		const body = await fixture("issue_comment.created.json");
		await deliverAs("issue_comment", body, "lane-armed-comment");
		const theirs = await stored("lane-armed-comment");
		expect(theirs.jobs.map((job) => job.name)).toEqual([GITHUB_EVALUATE_QUEUE]);

		const raw = JSON.parse(body);
		raw.comment.body = `${COMMENT_MARKER}\nBlocked.`;
		raw.comment.performed_via_github_app = { id: 1 };
		await deliverAs("issue_comment", JSON.stringify(raw), "lane-own-comment");
		const ours = await stored("lane-own-comment");
		expect(ours.event?.kind).toBe("comment.created");
		expect(ours.jobs).toEqual([]);
	});

	test("an armed repo keeps pushes only while a workflow triggers on them", async () => {
		const body = await fixture("push.json");
		await expectIgnored("push", body, "lane-push-unwatched");

		await db.insert(workflowDefinitions).values({
			id: generateId(),
			repoId,
			name: "On push",
			definition: {
				nodes: [{ id: "trigger", type: "trigger", kinds: ["push"] }],
			},
		});
		await deliverAs("push", body, "lane-push-watched");
		const { jobs } = await stored("lane-push-watched");
		expect(jobs.map((job) => job.name)).toEqual([GITHUB_EVALUATE_QUEUE]);
	});

	test("nothing is stored for a repo disconnected from Tripwire", async () => {
		await pool.query("UPDATE repos SET removed_at = now() WHERE id = $1", [
			repoId,
		]);
		await expectIgnored(
			"pull_request",
			await fixture("pull_request.synchronize.json"),
			"lane-removed",
		);
	});
});

/**
 * Ingest against the rule the delivery audit pages on: every delivery the
 * rule says must be kept is stored, and nothing else. If the router or the
 * rule changes alone, this fails, before production pages on it.
 */
describe("ingest keeps exactly what the delivery audit requires", () => {
	type State = NonNullable<GithubDeliveryTarget["repo"]> & { row: boolean };
	const STATES = {
		armed: {
			row: true,
			armed: true,
			claimed: true,
			removed: false,
			pushTriggered: false,
			claimedInstall: true,
		},
		"armed with a push workflow": {
			row: true,
			armed: true,
			claimed: true,
			removed: false,
			pushTriggered: true,
			claimedInstall: true,
		},
		"Tripwire off": {
			row: true,
			armed: false,
			claimed: true,
			removed: false,
			pushTriggered: false,
			claimedInstall: true,
		},
		"unclaimed repo": {
			row: true,
			armed: false,
			claimed: false,
			removed: false,
			pushTriggered: false,
			claimedInstall: false,
		},
		disconnected: {
			row: true,
			armed: true,
			claimed: true,
			removed: true,
			pushTriggered: false,
			claimedInstall: true,
		},
		"no row, claimed installation": {
			row: false,
			armed: false,
			claimed: false,
			removed: false,
			pushTriggered: false,
			claimedInstall: true,
		},
		"no row, unclaimed installation": {
			row: false,
			armed: false,
			claimed: false,
			removed: false,
			pushTriggered: false,
			claimedInstall: false,
		},
	} satisfies Record<string, State & { claimedInstall: boolean }>;

	/** [event, label, raw body] for every ingested event type. */
	async function deliveries(): Promise<[string, string, string][]> {
		const issue = JSON.parse(await fixture("issue_comment.created.json"));
		delete issue.comment;
		issue.action = "opened";
		return [
			["pull_request", "opened", await fixture("pull_request.opened.json")],
			[
				"pull_request",
				"synchronize",
				await fixture("pull_request.synchronize.json"),
			],
			["pull_request", "closed", await fixture("pull_request.closed.json")],
			[
				"pull_request",
				"bot edit",
				await fixture("pull_request.edited.body-by-bot.json"),
			],
			["issues", "opened", JSON.stringify(issue)],
			["issue_comment", "created", await fixture("issue_comment.created.json")],
			["push", "push", await fixture("push.json")],
		];
	}

	/** The same delivery, sent for another repo and installation. */
	function retarget(
		body: string,
		to: { repoId: string; owner: string; name: string; installation: string },
	): string {
		const raw = JSON.parse(body);
		raw.installation = { id: Number(to.installation) };
		raw.repository.id = Number(to.repoId);
		raw.repository.name = to.name;
		raw.repository.full_name = `${to.owner}/${to.name}`;
		raw.repository.owner.login = to.owner;
		raw.repository.owner.name = to.owner;
		return JSON.stringify(raw);
	}

	let n = 0;
	for (const [stateName, state] of Object.entries(STATES)) {
		test(`repo ${stateName}`, async () => {
			n++;
			const repoId = String(900_000 + n);
			const owner = "audit-parity";
			const name = `repo-${n}`;
			const installation = state.claimedInstall ? LINKED_INSTALLATION : "2";
			if (state.row) {
				const id = await repoServices.ensureRepo(db, {
					externalId: repoId,
					owner,
					name,
					fullName: `${owner}/${name}`,
					installationId: installation,
					orgId: state.claimed ? ORG_ID : undefined,
				});
				if (state.armed) await repoServices.setRepoArmed(db, id, true);
				if (state.removed)
					await pool.query(
						"UPDATE repos SET removed_at = now() WHERE id = $1",
						[id],
					);
				if (state.pushTriggered)
					await db.insert(workflowDefinitions).values({
						id: generateId(),
						repoId: id,
						name: "On push",
						definition: {
							nodes: [{ id: "trigger", type: "trigger", kinds: ["push"] }],
						},
					});
			}
			const target: GithubDeliveryTarget = {
				installationClaimed: state.claimedInstall,
				repo: state.row ? state : null,
			};
			const mismatches: string[] = [];
			for (const [eventName, label, fixtureBody] of await deliveries()) {
				const body = retarget(fixtureBody, {
					repoId,
					owner,
					name,
					installation,
				});
				const { action } = githubDeliveryActionSchema.parse(JSON.parse(body));
				const deliveryId = `parity-${n}-${eventName}-${label}`;
				const res = await app.request("/webhooks/github", {
					method: "POST",
					headers: {
						"x-github-delivery": deliveryId,
						"x-github-event": eventName,
						"x-hub-signature-256": signWebhookBody(body, SECRET),
					},
					body,
				});
				expect(res.status).toBe(200);
				const normalizes =
					normalizeWebhook(
						{ deliveryId, eventName, body, signature: null },
						new Date().toISOString(),
					) !== null;
				const expected =
					normalizes && githubDeliveryMustBeStored(eventName, action, target);
				const rows = await pool.query(
					"SELECT 1 FROM events WHERE delivery_id = $1",
					[deliveryId],
				);
				if (rows.rows.length > 0 !== expected)
					mismatches.push(
						`${eventName} ${label}: expected ${expected ? "stored" : "dropped"}`,
					);
			}
			expect(mismatches).toEqual([]);
		});
	}

	test("installation events are stored whoever owns the installation", async () => {
		for (const [eventName, name] of [
			["installation", "installation.created.json"],
			["installation_repositories", "installation_repositories.added.json"],
		] as const) {
			const body = await fixture(name);
			const deliveryId = `parity-${name}`;
			await app.request("/webhooks/github", {
				method: "POST",
				headers: {
					"x-github-delivery": deliveryId,
					"x-github-event": eventName,
					"x-hub-signature-256": signWebhookBody(body, SECRET),
				},
				body,
			});
			const rows = await pool.query(
				"SELECT 1 FROM events WHERE delivery_id = $1",
				[deliveryId],
			);
			expect(rows.rows.length).toBe(1);
		}
	});
});
