import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
	type Forge,
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	GITCAFE_RECEIPT_MAX_BYTES,
	gitCafeInstallationCreatedSchema,
	gitCafeInstallationSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	gitCafeReceipts,
	organization,
	organizationInstallations,
	repos,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { PgBoss } from "pg-boss";
import pino from "pino";
import type { ApiDeps } from "./env.ts";
import { resolveGitCafeReceiptConfig } from "./gitcafe-receipts.ts";
import { createApi } from "./index.ts";

const fixtureRoot = new URL(
	"../fixtures/",
	import.meta.resolve("@tripwire/forge-gitcafe"),
);
const installation = gitCafeInstallationSchema.parse(
	await Bun.file(new URL("gitcafe-installation.json", fixtureRoot)).json(),
);
const created = gitCafeInstallationCreatedSchema.parse(
	await Bun.file(
		new URL("gitcafe-installation-created.json", fixtureRoot),
	).json(),
);

const SECRET = "local-receipt-test-key";
const KEY_VERSION = "local-test-1";
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let app: ReturnType<typeof createApi>;

const dependencies = (): ApiDeps => ({
	auth: null,
	db,
	pool,
	directPool: pool,
	boss,
	webhookSecret: "github-test-key",
	webOrigin: "http://localhost:4321",
	logger: pino({ level: "silent" }),
	gitCafeReceipts: {
		appId: GITCAFE_RECEIPT_APP_ID,
		secret: SECRET,
		keyVersion: KEY_VERSION,
	},
});

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	const bootstrap = new PgBoss({
		connectionString: container.url,
		schedule: false,
		supervise: false,
	});
	await bootstrap.start();
	await bootstrap.stop({ close: true, graceful: false });
	boss = await gitCafeLifecycleServices.createGitCafeLifecycleBoss(
		container.url,
		pino({ level: "silent" }),
	);
	app = createApi(dependencies());
}, 120_000);

beforeEach(async () => {
	await pool.query(
		"TRUNCATE gitcafe_receipts, gitcafe_installation_lifecycle, repos CASCADE",
	);
	await pool.query("TRUNCATE pgboss.job");
});

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function fixtureBody() {
	return Bun.file(
		new URL(
			"../../../packages/forge-gitcafe/fixtures/gitcafe-installation-created.json",
			import.meta.url,
		),
	).text();
}

async function deliver(
	body: string | Uint8Array,
	changes: Record<string, string> = {},
	target = app,
) {
	const timestamp =
		changes["x-gitcafe-timestamp"] ?? String(Math.floor(Date.now() / 1000));
	const signature = `sha256=${createHmac("sha256", SECRET).update(`${timestamp}.`).update(body).digest("hex")}`;
	return target.request("/webhooks/gitcafe", {
		method: "POST",
		body,
		headers: {
			"content-type": "application/json",
			"x-gitcafe-delivery": "test-delivery",
			"x-gitcafe-event": created.type,
			"x-gitcafe-timestamp": timestamp,
			"x-gitcafe-key-version": KEY_VERSION,
			"x-gitcafe-signature": signature,
			...changes,
		},
	});
}

async function seedRepo(
	input: {
		installationId?: string;
		forge?: Forge;
		name?: string;
		externalId?: string;
		orgId?: string;
	} = {},
) {
	const id = generateId();
	const name = input.name ?? "scratch";
	await db.insert(repos).values({
		id,
		forge: input.forge ?? "gitcafe",
		externalId: input.externalId ?? generateId(),
		owner: "boring",
		name,
		fullName: `boring/${name}`,
		installationId: input.installationId ?? installation.id,
		orgId: input.orgId ?? generateId(),
		armed: true,
	});
	return id;
}

const readRepo = async (id: string) =>
	(await db.select().from(repos).where(eq(repos.id, id)))[0];

describe("GitCafe isolated receipt admission", () => {
	test("signed bytes, installation/body ID dedupe and durable enqueue stay outside normal ingest", async () => {
		const body = await fixtureBody();
		expect((await deliver(body)).status).toBe(200);
		const [receipt] = await db.select().from(gitCafeReceipts);
		if (!receipt) throw new Error("receipt missing");
		expect(receipt?.receipt.bodyBase64).toBe(
			Buffer.from(body).toString("base64"),
		);
		expect(receipt?.receipt.bodySha256).toBe(
			createHash("sha256").update(body).digest("hex"),
		);
		const jobs = await pool.query<{
			name: string;
			data: { receiptId: string; requestId: string };
		}>("SELECT name, data FROM pgboss.job");
		expect(jobs.rows).toEqual([
			{
				name: GITCAFE_LIFECYCLE_QUEUE,
				data: { receiptId: receipt?.id, requestId: receipt?.receipt.requestId },
			},
		]);
		expect(
			await (
				await deliver(body, { "x-gitcafe-delivery": "different-delivery" })
			).json(),
		).toEqual({ ok: true, duplicate: true });
		expect((await pool.query("SELECT id FROM pgboss.job")).rowCount).toBe(1);
		expect((await pool.query("SELECT id FROM events")).rowCount).toBe(0);
		expect((await pool.query("SELECT id FROM runs")).rowCount).toBe(0);
	});

	test("same event ID in different installations is admitted independently", async () => {
		const body = await fixtureBody();
		await deliver(body);
		const other = body.replace(installation.id, "ins_other_test_scope");
		expect((await deliver(other)).status).toBe(200);
		expect((await db.select().from(gitCafeReceipts)).length).toBe(2);
	});

	test("concurrent semantic redeliveries enqueue once", async () => {
		const body = await fixtureBody();
		const responses = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				deliver(body, { "x-gitcafe-delivery": `retry-${i}` }),
			),
		);
		expect(responses.every((response) => response.status === 200)).toBe(true);
		expect((await db.select().from(gitCafeReceipts)).length).toBe(1);
		expect((await pool.query("SELECT id FROM pgboss.job")).rowCount).toBe(1);
	});

	test("queue failure rolls the receipt back", async () => {
		const fail = spyOn(boss, "insert").mockRejectedValueOnce(
			new Error("injected queue failure"),
		);
		try {
			expect((await deliver(await fixtureBody())).status).toBe(500);
		} finally {
			fail.mockRestore();
		}
		expect((await db.select().from(gitCafeReceipts)).length).toBe(0);
		expect((await pool.query("SELECT id FROM pgboss.job")).rowCount).toBe(0);
	});

	test("a queue insert that returns no job also rolls the receipt back", async () => {
		const empty = spyOn(boss, "insert").mockResolvedValueOnce(null);
		try {
			expect((await deliver(await fixtureBody())).status).toBe(500);
		} finally {
			empty.mockRestore();
		}
		expect((await db.select().from(gitCafeReceipts)).length).toBe(0);
	});

	test("timestamp, key, signature, header/body mismatch and malformed input have no effects", async () => {
		const body = await fixtureBody();
		for (const [changes, expected] of [
			[
				{ "x-gitcafe-timestamp": String(Math.floor(Date.now() / 1000) - 301) },
				401,
			],
			[
				{ "x-gitcafe-timestamp": String(Math.floor(Date.now() / 1000) + 60) },
				401,
			],
			[{ "x-gitcafe-timestamp": "1e12" }, 401],
			[{ "x-gitcafe-key-version": "wrong-key" }, 401],
			[{ "x-gitcafe-signature": `sha256=${"0".repeat(64)}` }, 401],
			[{ "x-gitcafe-signature": "sha256=bad" }, 401],
			[{ "x-gitcafe-event": "installation.uninstalled" }, 400],
			[{ "content-type": "text/plain" }, 415],
			[{ "x-gitcafe-delivery": "" }, 400],
		] as const)
			expect((await deliver(body, changes)).status).toBe(expected);
		expect((await deliver("{")).status).toBe(400);
		expect((await deliver("null")).status).toBe(400);
		expect((await deliver(new Uint8Array([0xff, 0xfe]))).status).toBe(400);
		expect((await db.select().from(gitCafeReceipts)).length).toBe(0);
		expect((await db.select().from(gitCafeInstallationLifecycle)).length).toBe(
			0,
		);
	});

	test("HMAC uses the exact bytes including whitespace", async () => {
		const body = `${(await fixtureBody()).trimEnd()} \n`;
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = `sha256=${createHmac("sha256", SECRET).update(`${timestamp}.`).update(body).digest("hex")}`;
		expect(
			(
				await deliver(body.trimEnd(), {
					"x-gitcafe-timestamp": timestamp,
					"x-gitcafe-signature": signature,
				})
			).status,
		).toBe(401);
		expect((await deliver(body)).status).toBe(200);
	});

	test("body limit applies without content-length", async () => {
		expect(
			(await deliver(" ".repeat(GITCAFE_RECEIPT_MAX_BYTES + 1))).status,
		).toBe(413);
		expect((await db.select().from(gitCafeReceipts)).length).toBe(0);
	});

	test("disabled receipt admission stays 404; production and wrong app refuse configuration", async () => {
		const disabled = createApi({ ...dependencies(), gitCafeReceipts: null });
		expect((await deliver(await fixtureBody(), {}, disabled)).status).toBe(404);
		expect(resolveGitCafeReceiptConfig({})).toBeNull();
		const env = {
			GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "true",
			UNKEY_ENVIRONMENT_SLUG: "preview",
			GITCAFE_APP_ID: GITCAFE_RECEIPT_APP_ID,
			GITCAFE_WEBHOOK_KEY_VERSION: KEY_VERSION,
			GITCAFE_WEBHOOK_SECRET: SECRET,
		};
		expect(resolveGitCafeReceiptConfig(env)?.appId).toBe(
			GITCAFE_RECEIPT_APP_ID,
		);
		for (const change of [
			{ UNKEY_ENVIRONMENT_SLUG: "production" },
			{ GITCAFE_APP_ID: "wrong-app" },
			{ GITCAFE_WEBHOOK_SECRET: undefined },
		])
			expect(() =>
				resolveGitCafeReceiptConfig({ ...env, ...change }),
			).toThrow();
	});

	test("created receipt cannot claim, restore visibility, arm, or grant action authority; replay is inert", async () => {
		const repoId = await seedRepo();
		await gitCafeLifecycleServices.retireGitCafeInstallation(db, {
			installationId: installation.id,
			reason: "uninstalled",
		});
		await deliver(await fixtureBody());
		const [receipt] = await db.select().from(gitCafeReceipts);
		if (!receipt) throw new Error("receipt missing");
		expect(
			await gitCafeLifecycleServices.processGitCafeReceipt(db, receipt.id),
		).toBe("stale");
		expect(
			await gitCafeLifecycleServices.processGitCafeReceipt(db, receipt.id),
		).toBe("stale");
		expect((await readRepo(repoId))?.removedAt).not.toBeNull();
		expect((await readRepo(repoId))?.armed).toBe(false);
		expect(
			await gitCafeLifecycleServices.getGitCafeActionAuthority(
				db,
				installation.id,
			),
		).toEqual({ allowed: false });
	});

	test("uncaptured event kinds park; malformed lifecycle schemas leave repositories and state unchanged", async () => {
		const repoId = await seedRepo();
		const body = await fixtureBody();
		for (const [kind, expected] of [
			["pull.opened", "parked"],
			["installation.repositories_updated", "malformed"],
		] as const) {
			const negative = body
				.replace(created.type, kind)
				.replace(created.id, `evt_${generateId()}`);
			expect(
				(await deliver(negative, { "x-gitcafe-event": kind })).status,
			).toBe(200);
			const [receipt] = await db
				.select()
				.from(gitCafeReceipts)
				.where(eq(gitCafeReceipts.eventType, kind));
			if (!receipt) throw new Error("receipt missing");
			expect(
				await gitCafeLifecycleServices.processGitCafeReceipt(db, receipt.id),
			).toBe(expected);
		}
		expect((await readRepo(repoId))?.removedAt).toBeNull();
		expect((await readRepo(repoId))?.armed).toBe(true);
		expect((await db.select().from(gitCafeInstallationLifecycle)).length).toBe(
			0,
		);
	});
});

describe("GitCafe lifecycle repair from captured installation authority", () => {
	test("an event sharing the authority timestamp withdraws authority rather than assuming an order", async () => {
		await db.insert(gitCafeInstallationLifecycle).values({
			installationId: installation.id,
			status: "active",
			authorityAt: new Date(created.createdAt),
			providerVersion: installation.version,
		});
		await deliver(await fixtureBody());
		const [receipt] = await db.select().from(gitCafeReceipts);
		if (!receipt) throw new Error("receipt missing");
		expect(
			await gitCafeLifecycleServices.processGitCafeReceipt(db, receipt.id),
		).toBe("applied");
		expect(
			await gitCafeLifecycleServices.getGitCafeActionAuthority(
				db,
				installation.id,
			),
		).toEqual({ allowed: false });
	});

	test("pending lifecycle receipts fence action authority before the consumer runs", async () => {
		await seedRepo();
		await gitCafeLifecycleServices.reconcileGitCafeInstallation(db, {
			installationId: installation.id,
			expectedAppId: installation.appId,
			lookup: async () => ({
				ok: true,
				value: gitCafeInstallationSchema.parse(installation),
			}),
		});
		expect(
			(
				await gitCafeLifecycleServices.getGitCafeActionAuthority(
					db,
					installation.id,
				)
			).allowed,
		).toBe(true);
		const kind = "installation.repositories_updated";
		const negative = (await fixtureBody()).replace(created.type, kind);
		await deliver(negative, { "x-gitcafe-event": kind });
		expect(
			await gitCafeLifecycleServices.getGitCafeActionAuthority(
				db,
				installation.id,
			),
		).toEqual({ allowed: false });
		const [receipt] = await db.select().from(gitCafeReceipts);
		if (!receipt) throw new Error("receipt missing");
		expect(
			await gitCafeLifecycleServices.processGitCafeReceipt(db, receipt.id),
		).toBe("malformed");
		expect(
			(
				await gitCafeLifecycleServices.getGitCafeActionAuthority(
					db,
					installation.id,
				)
			).allowed,
		).toBe(true);
	});

	test("retirement affects only one forge and installation and preserves claims and historical repo rows", async () => {
		const orgId = generateId();
		await db.insert(organization).values({
			id: orgId,
			name: "Lifecycle test",
			slug: `lifecycle-${orgId}`,
		});
		await db.insert(organizationInstallations).values({
			id: generateId(),
			forge: "gitcafe",
			installationId: installation.id,
			organizationId: orgId,
		});
		const target = await seedRepo({ orgId, name: "old-tripwire" });
		const sibling = await seedRepo({
			installationId: "ins_new_scratch",
			name: "scratch",
		});
		const github = await seedRepo({ forge: "github", name: "old-tripwire" });
		const result = await gitCafeLifecycleServices.retireGitCafeInstallation(
			db,
			{ installationId: installation.id, reason: "uninstalled" },
		);
		expect(result.removedCount).toBe(1);
		expect(await readRepo(target)).toMatchObject({
			armed: false,
			installationId: installation.id,
			orgId,
		});
		expect((await readRepo(target))?.removedAt).not.toBeNull();
		expect((await readRepo(sibling))?.removedAt).toBeNull();
		expect((await readRepo(github))?.removedAt).toBeNull();
		expect(
			(
				await db
					.select()
					.from(organizationInstallations)
					.where(eq(organizationInstallations.installationId, installation.id))
			).length,
		).toBe(1);
	});

	test("generic forbidden lookup hides stale installation without claiming it was uninstalled", async () => {
		const target = await seedRepo({ name: "old-tripwire" });
		const sibling = await seedRepo({
			installationId: "ins_new_scratch",
			name: "scratch",
		});
		const result = await gitCafeLifecycleServices.reconcileGitCafeInstallation(
			db,
			{
				installationId: installation.id,
				expectedAppId: installation.appId,
				lookup: async () => ({ ok: false, reason: "http", status: 403 }),
			},
		);
		expect(result).toMatchObject({
			ok: true,
			status: "reconcile-required",
			removedCount: 1,
		});
		expect((await readRepo(target))?.removedAt).not.toBeNull();
		expect((await readRepo(sibling))?.removedAt).toBeNull();
		expect(
			await gitCafeLifecycleServices.getGitCafeActionAuthority(
				db,
				installation.id,
			),
		).toEqual({ allowed: false });
	});

	test("fresh selected lookup revokes stale selection without restoring removed rows", async () => {
		const stale = await seedRepo({ name: "stale-selection" });
		const selected = await seedRepo({ name: "scratch" });
		const authority = gitCafeInstallationSchema.parse(installation);
		const reconcile = () =>
			gitCafeLifecycleServices.reconcileGitCafeInstallation(db, {
				installationId: installation.id,
				expectedAppId: installation.appId,
				lookup: async () => ({ ok: true, value: authority }),
			});
		expect(await reconcile()).toMatchObject({
			ok: true,
			status: "active",
			removedCount: 1,
		});
		expect((await readRepo(stale))?.removedAt).not.toBeNull();
		expect((await readRepo(stale))?.armed).toBe(false);
		expect((await readRepo(selected))?.removedAt).toBeNull();
		const fence = await gitCafeLifecycleServices.getGitCafeActionAuthority(
			db,
			installation.id,
		);
		expect(fence.allowed).toBe(true);
		await gitCafeLifecycleServices.retireGitCafeInstallation(db, {
			installationId: installation.id,
			reason: "reconcile-required",
		});
		expect(
			await gitCafeLifecycleServices.getGitCafeActionAuthority(
				db,
				installation.id,
				fence.allowed ? fence.generation : 0,
			),
		).toEqual({ allowed: false });
		expect(await reconcile()).toMatchObject({ ok: true, status: "active" });
		expect((await readRepo(selected))?.removedAt).not.toBeNull();
	});

	test("in-flight fresh lookup cannot undo concurrent uninstall or activate an old generation", async () => {
		await seedRepo();
		const result = await gitCafeLifecycleServices.reconcileGitCafeInstallation(
			db,
			{
				installationId: installation.id,
				expectedAppId: installation.appId,
				lookup: async () => {
					await gitCafeLifecycleServices.retireGitCafeInstallation(db, {
						installationId: installation.id,
						reason: "uninstalled",
					});
					return {
						ok: true,
						value: gitCafeInstallationSchema.parse(installation),
					};
				},
			},
		);
		expect(result).toEqual({ ok: false, reason: "stale" });
		expect(
			(await db.select().from(gitCafeInstallationLifecycle))[0]?.status,
		).toBe("uninstalled");
	});

	test("a stale provider version cannot overwrite newer stored authority", async () => {
		await seedRepo();
		await db.insert(gitCafeInstallationLifecycle).values({
			installationId: installation.id,
			status: "reconcile-required",
			providerVersion: installation.version + 1,
		});
		expect(
			await gitCafeLifecycleServices.reconcileGitCafeInstallation(db, {
				installationId: installation.id,
				expectedAppId: installation.appId,
				lookup: async () => ({
					ok: true,
					value: gitCafeInstallationSchema.parse(installation),
				}),
			}),
		).toEqual({ ok: false, reason: "stale" });
	});
});
