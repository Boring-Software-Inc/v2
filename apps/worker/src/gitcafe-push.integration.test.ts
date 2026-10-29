import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	GITCAFE_REFRESH_CATALOGS_QUEUE,
	gitCafePushEventSchema,
	gitCafeReceiptSchema,
	normalizedEventSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	eventServices,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	organization,
	organizationInstallations,
	repos,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import installation from "@tripwire/forge-gitcafe/fixtures/gitcafe-action-installation-current.json";
import token from "@tripwire/forge-gitcafe/fixtures/gitcafe-action-token-current.json";
import members from "@tripwire/forge-gitcafe/fixtures/gitcafe-connection-members.json";
import repository from "@tripwire/forge-gitcafe/fixtures/gitcafe-connection-repository.json";
import captured from "@tripwire/forge-gitcafe/fixtures/gitcafe-git-push-webhook.json";
import profile from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-profile.json";
import refs from "@tripwire/forge-gitcafe/fixtures/gitcafe-read-refs.json";
import { generateId } from "@tripwire/utils";
import { sql } from "drizzle-orm";
import pino from "pino";
import { buildGitCafeRuntime } from "./gitcafe-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";

let container: TestDatabase;
let database: ReturnType<typeof createDb>;
let boss: Awaited<ReturnType<typeof createBoss>>;
const source = gitCafePushEventSchema.parse(captured);
const first =
	source.git.refUpdates.at(0) ??
	(() => {
		throw new Error("Missing captured ref");
	})();
const logger = pino({ level: "silent" });
const credentials = {
	appId: installation.appId,
	keyId: "push-integration",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};
beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
	boss = await createBoss(container.url);
	await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
	await boss.createQueue(GITCAFE_PROCESS_EVENT_QUEUE);
	await boss.createQueue(GITCAFE_REFRESH_CATALOGS_QUEUE, { policy: "stately" });
}, 120_000);
beforeEach(async () => {
	await database.db.execute(
		sql`TRUNCATE events,repos,organization,gitcafe_installation_lifecycle,gitcafe_receipts CASCADE`,
	);
	await database.pool.query("DELETE FROM pgboss.job");
	const orgId = generateId();
	await database.db
		.insert(organization)
		.values({ id: orgId, name: "Push tests", slug: `push-${orgId}` });
	await database.db.insert(organizationInstallations).values({
		id: generateId(),
		forge: "gitcafe",
		installationId: installation.id,
		organizationId: orgId,
		accountLogin: installation.org,
	});
	await database.db.insert(repos).values({
		id: generateId(),
		forge: "gitcafe",
		externalId: repository.id,
		owner: repository.owner,
		name: repository.name,
		fullName: "boring/scratch",
		installationId: installation.id,
		orgId,
		armed: false,
	});
	await database.db.insert(gitCafeInstallationLifecycle).values({
		installationId: installation.id,
		status: "active",
		generation: 1,
		authorityAt: new Date(),
	});
});
afterAll(async () => {
	await boss?.stop({ graceful: false, close: true });
	await database?.pool.end();
	await container?.stop();
});

/** Controlled semantic deliveries retain every original field; additional refs are explicit test mutations. */
async function admit(
	refCount = 2,
	mutation?: "truncated" | "count" | "duplicate" | "bot",
) {
	const payload = {
		...captured,
		id: `evt_${generateId()}`,
		actor:
			mutation === "bot" ? { id: installation.bot.actorId } : captured.actor,
		git: {
			...captured.git,
			refUpdates: Array.from({ length: refCount }, (_, i) =>
				i === 0 ? first : { ...first, ref: `refs/heads/synthetic-${i}` },
			),
			refUpdatesCount: refCount,
		},
	};
	if (mutation === "truncated") payload.git.refUpdatesTruncated = true;
	if (mutation === "count") payload.git.refUpdatesCount++;
	if (mutation === "duplicate")
		payload.git.refUpdates = Array.from({ length: refCount }, () => ({
			...first,
		}));
	const body = JSON.stringify(payload);
	const receipt = gitCafeReceiptSchema.parse({
		format: "gitcafe-receipt@1",
		appId: GITCAFE_RECEIPT_APP_ID,
		payload,
		bodyBase64: Buffer.from(body).toString("base64"),
		bodySha256: createHash("sha256").update(body).digest("hex"),
		deliveryId: generateId(),
		keyVersion: "local-test",
		signedAt: String(Math.floor(Date.now() / 1000)),
		requestId: generateId(),
	});
	const inserted = await gitCafeLifecycleServices.insertGitCafeReceipt(
		database.pool,
		boss,
		receipt,
	);
	return { ...inserted, payload };
}
async function rows() {
	return (
		await database.pool.query<{
			id: string;
			delivery_id: string;
			raw: unknown;
			processed_at: Date | null;
		}>(
			"SELECT id,delivery_id,raw,processed_at FROM events ORDER BY delivery_id",
		)
	).rows;
}
async function status(id: string) {
	return (
		await database.pool.query(
			"SELECT status FROM gitcafe_receipts WHERE id=$1",
			[id],
		)
	).rows[0]?.status;
}
function runtime(currentHead = first.afterOid) {
	return buildGitCafeRuntime(database.db, credentials, async (url, init) => {
		const u = new URL(url);
		if (u.pathname.includes("/apps/installations/"))
			return Response.json(
				init.method === "GET"
					? installation
					: {
							...token,
							token: "synthetic-push-token",
							expiresAt: new Date(Date.now() + 900000).toISOString(),
						},
			);
		if (u.pathname === "/api/repos/boring/scratch")
			return Response.json(repository);
		if (u.pathname.endsWith("/members/")) return Response.json(members);
		if (u.pathname.endsWith("/users/grim")) return Response.json(profile);
		if (u.pathname.endsWith("/refs"))
			return Response.json({
				...refs,
				items: refs.items.map((ref) => ({ ...ref, oid: currentHead })),
			});
		return new Response(null, { status: 599 });
	});
}

test("multi-ref dispatch atomically preserves raw payloads and deduplicates concurrent receipt processing", async () => {
	const admitted = await admit();
	const results = await Promise.all([
		gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
		gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
	]);
	expect(results).toEqual(["dispatched", "dispatched"]);
	const found = await rows();
	expect(found).toHaveLength(2);
	for (const row of found) {
		expect(row.raw).toEqual(admitted.payload);
		expect(JSON.parse(row.delivery_id).slice(0, 2)).toEqual([
			installation.id,
			admitted.payload.id,
		]);
	}
	expect(
		(
			await database.pool.query(
				"SELECT count(*)::int AS count FROM pgboss.job WHERE name=$1",
				[GITCAFE_PROCESS_EVENT_QUEUE],
			)
		).rows[0].count,
	).toBe(2);
	expect(
		(
			await database.pool.query(
				"SELECT count(*)::int AS count FROM pgboss.job WHERE name=$1",
				[GITCAFE_REFRESH_CATALOGS_QUEUE],
			)
		).rows[0].count,
	).toBe(1);
});

test("failure while enqueueing a later ref rolls back every raw row and permits a complete retry", async () => {
	const admitted = await admit();
	const insert = boss.insert.bind(boss);
	let calls = 0;
	const fail = spyOn(boss, "insert").mockImplementation(async (...args) => {
		if (++calls === 2) throw new Error("synthetic-second-ref-outage");
		return insert(...args);
	});
	try {
		await expect(
			gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
				database.db,
				boss,
				admitted.receiptId,
			),
		).rejects.toThrow("synthetic-second-ref-outage");
	} finally {
		fail.mockRestore();
	}
	expect(await rows()).toHaveLength(0);
	expect(await status(admitted.receiptId)).toBe("pending");
	expect(
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
	).toBe("dispatched");
	expect(await rows()).toHaveLength(2);
});

test("one completed ref cannot settle the receipt or resurrect while another ref needs recovery", async () => {
	const admitted = await admit();
	await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	const found = await rows();
	const [a, b] = found;
	if (!a || !b) throw new Error("Missing fanout");
	await gitCafeLifecycleServices.finishGitCafeEvent(database.db, a.id);
	expect(await status(admitted.receiptId)).toBe("dispatched");
	await database.pool.query("DELETE FROM pgboss.job WHERE name=$1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(1);
	expect(
		(
			await database.pool.query(
				"SELECT data->>'eventId' AS id FROM pgboss.job WHERE name=$1",
				[GITCAFE_PROCESS_EVENT_QUEUE],
			)
		).rows,
	).toEqual([{ id: b.id }]);
	await Promise.all([
		gitCafeLifecycleServices.finishGitCafeEvent(database.db, b.id),
		gitCafeLifecycleServices.finishGitCafeEvent(database.db, a.id),
	]);
	expect(await status(admitted.receiptId)).toBe("applied");
	await database.pool.query("DELETE FROM pgboss.job WHERE name=$1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	for (const row of await rows()) expect(row.raw).toEqual(admitted.payload);
});

for (const mutation of ["truncated", "count", "duplicate"] as const)
	test(`${mutation} push refuses partial fanout`, async () => {
		const admitted = await admit(2, mutation);
		expect(
			await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
				database.db,
				boss,
				admitted.receiptId,
			),
		).toBe("malformed");
		expect(await rows()).toHaveLength(0);
	});
test("a complete empty push is settled without inventing a ref event", async () => {
	const admitted = await admit(0);
	expect(
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
	).toBe("applied");
	expect(await rows()).toHaveLength(0);
});
test("historical parked push receipts stay parked", async () => {
	const admitted = await admit();
	await database.pool.query(
		"UPDATE gitcafe_receipts SET status='parked' WHERE id=$1",
		[admitted.receiptId],
	);
	expect(
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
	).toBe("parked");
	expect(await rows()).toHaveLength(0);
});

for (const scenario of ["healthy", "stale-head", "bot"] as const)
	test(`actual runtime ${scenario} binds the selected ref and immutable actor`, async () => {
		const admitted = await admit(1, scenario === "bot" ? "bot" : undefined);
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		);
		const row = (await rows())[0];
		if (!row) throw new Error("Missing push event");
		const forge = runtime(
			scenario === "stale-head" ? "0".repeat(40) : first.afterOid,
		);
		await processEvent(
			{
				db: database.db,
				pool: database.pool,
				logger,
				resolveForge: () => forge,
				makeGenerate: null,
				appUrl: "https://tripwire.test",
				resumeNormalized: true,
			},
			{ eventId: row.id },
		);
		const saved = await eventServices.getEventById(database.db, row.id);
		expect(saved?.raw).toEqual(admitted.payload);
		if (scenario === "stale-head") {
			expect(saved?.normalizedAt).toBeNull();
			return;
		}
		const parsed = normalizedEventSchema.parse(saved?.normalized);
		expect(parsed.kind).toBe("push");
		expect(parsed.actor.externalId).toBe(
			scenario === "bot" ? installation.bot.actorId : profile.actorId,
		);
		expect(forge.isSelfEvent?.(parsed)).toBe(scenario === "bot");
	});

test("an interrupted push is rehydrated before evaluation and refuses a changed head", async () => {
	const admitted = await admit(1);
	await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	const row = (await rows())[0];
	if (!row) throw new Error("Missing push event");
	const deps = (forge: ReturnType<typeof runtime>) => ({
		db: database.db,
		pool: database.pool,
		logger,
		resolveForge: () => forge,
		makeGenerate: null,
		appUrl: "https://tripwire.test",
		resumeNormalized: true,
	});
	const original = eventServices.markEventNormalized;
	const interrupted = spyOn(
		eventServices,
		"markEventNormalized",
	).mockImplementationOnce(async (...args) => {
		await original(...args);
		throw new Error("Interrupted after push normalization");
	});
	try {
		await expect(
			processEvent(deps(runtime()), { eventId: row.id }),
		).rejects.toThrow("Interrupted after push normalization");
	} finally {
		interrupted.mockRestore();
	}
	const saved = await eventServices.getEventById(database.db, row.id);
	expect(saved?.normalizedAt).not.toBeNull();
	expect(await runServices.getRunForEvent(database.db, row.id)).toBeNull();
	const changed = runtime("0".repeat(40));
	const preparation = spyOn(changed, "prepareEvent");
	try {
		await processEvent(deps(changed), { eventId: row.id });
		expect(preparation).toHaveBeenCalledTimes(1);
		expect(await preparation.mock.results[0]?.value).toEqual({
			ok: false,
			reason: "stale-event",
		});
	} finally {
		preparation.mockRestore();
	}
	expect(await runServices.getRunForEvent(database.db, row.id)).toBeNull();
	expect((await eventServices.getEventById(database.db, row.id))?.raw).toEqual(
		admitted.payload,
	);
});
