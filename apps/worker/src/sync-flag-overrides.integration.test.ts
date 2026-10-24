import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type DatabuddyFlag,
	isTripwireRule,
	type JsonValue,
} from "@tripwire/contracts";
import {
	accountDeletionServices,
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	flagOverrideServices,
	SYNC_FLAG_OVERRIDES_QUEUE,
	type SyncFlagOverridesJob,
	schema,
	syncFlagOverridesOptions,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import {
	DATABUDDY_NOT_CONNECTED,
	FLAG_REMOVAL_GRACE_MS,
	FlagSyncFailedError,
	sweepFlagRemovals,
	syncFlagOverridesJob,
} from "./jobs/sync-flag-overrides.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let boss: PgBoss;
const logger = pino({ level: "silent" });

const theirRule = {
	type: "email",
	operator: "ends_with",
	value: "@lumenlabs.dev",
	enabled: true,
	batch: false,
};

function fakeApi(flag: DatabuddyFlag, failures: number) {
	let left = failures;
	const state = { flag, calls: 0 };
	return {
		state,
		api: {
			async getFlagByKey(key: string) {
				state.calls++;
				if (left > 0) {
					left--;
					throw new Error("Databuddy answered 503");
				}
				return key === state.flag.key ? structuredClone(state.flag) : null;
			},
			async updateFlagRules(_id: string, rules: JsonValue[]) {
				state.flag = { ...state.flag, rules: structuredClone(rules) };
				return structuredClone(state.flag);
			},
		},
	};
}

async function seedOverride(flagKey: string): Promise<string> {
	const id = generateId();
	await db
		.insert(schema.user)
		.values({ id, name: `u-${id}`, email: `${id}@example.com` });
	await flagOverrideServices.setUserFlagOverride(db, {
		userId: id,
		flagKey,
		choice: "on",
		actorId: id,
	});
	return id;
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	boss = await createBoss(container.url);
});

afterAll(async () => {
	await boss.stop({ graceful: false });
	await pool.end();
	await container.stop();
});

describe("sync-flag-overrides job", () => {
	test("throws on a failed sync so pg-boss retries it", async () => {
		const userId = await seedOverride("retry-flag");
		const fake = fakeApi(
			{ id: "f1", key: "retry-flag", rules: [theirRule] },
			1,
		);
		await expect(
			syncFlagOverridesJob(
				{ db, api: fake.api, logger },
				{ flagKey: "retry-flag" },
			),
		).rejects.toBeInstanceOf(FlagSyncFailedError);
		const [failed] = await flagOverrideServices.listUserFlagOverrides(
			db,
			userId,
		);
		expect(failed?.syncStatus).toBe("failed");

		const result = await syncFlagOverridesJob(
			{ db, api: fake.api, logger },
			{ flagKey: "retry-flag" },
		);
		expect(result?.status).toBe("synced");
		expect(fake.state.flag.rules).toContainEqual(theirRule);
	});

	test("without an api key the rows say Databuddy is not connected", async () => {
		const userId = await seedOverride("offline-flag");
		const result = await syncFlagOverridesJob(
			{ db, api: null, logger },
			{ flagKey: "offline-flag" },
		);
		expect(result).toBeNull();
		const [row] = await flagOverrideServices.listUserFlagOverrides(db, userId);
		expect(row).toMatchObject({
			syncStatus: "failed",
			syncError: DATABUDDY_NOT_CONNECTED,
		});
	});

	test("pg-boss delivers the job again after a failure until it syncs", async () => {
		const userId = await seedOverride("queued-flag");
		const fake = fakeApi(
			{ id: "f2", key: "queued-flag", rules: [theirRule] },
			2,
		);
		await boss.work<SyncFlagOverridesJob>(
			SYNC_FLAG_OVERRIDES_QUEUE,
			{ pollingIntervalSeconds: 0.5 },
			async (jobs) => {
				for (const job of jobs) {
					await syncFlagOverridesJob({ db, api: fake.api, logger }, job.data);
				}
			},
		);
		await boss.send(
			SYNC_FLAG_OVERRIDES_QUEUE,
			{ flagKey: "queued-flag" },
			{
				...syncFlagOverridesOptions("queued-flag"),
				retryDelay: 1,
				retryBackoff: false,
			},
		);
		const deadline = Date.now() + 30_000;
		for (;;) {
			const [row] = await flagOverrideServices.listUserFlagOverrides(
				db,
				userId,
			);
			if (row?.syncStatus === "synced") {
				break;
			}
			if (Date.now() > deadline) {
				throw new Error(`still ${row?.syncStatus} after 30s`);
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		expect(fake.state.calls).toBe(3);
		const rules = fake.state.flag.rules ?? [];
		expect(rules.filter(isTripwireRule)).toHaveLength(1);
		expect(rules).toContainEqual(theirRule);
		await boss.offWork(SYNC_FLAG_OVERRIDES_QUEUE);
	}, 40_000);

	test("the queue keeps one pending sync per flag", () => {
		expect(syncFlagOverridesOptions("show-sidebar")).toMatchObject({
			singletonKey: "show-sidebar",
			retryLimit: 5,
		});
	});
});

describe("sweep-flag-removals", () => {
	test("queues a sync for a deleted user's flag once the grace period passes", async () => {
		const userId = await seedOverride("sweep-flag");
		await accountDeletionServices.deleteUserAccount(db, userId);
		const queued: string[] = [];
		const enqueue = async (flagKey: string) => {
			queued.push(flagKey);
		};
		await sweepFlagRemovals({ db, enqueue, logger }, new Date());
		expect(queued).toEqual([]);
		await sweepFlagRemovals(
			{ db, enqueue, logger },
			new Date(Date.now() + FLAG_REMOVAL_GRACE_MS + 1000),
		);
		expect(queued).toEqual(["sweep-flag"]);
	});
});
