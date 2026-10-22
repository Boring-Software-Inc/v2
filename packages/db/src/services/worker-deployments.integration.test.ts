import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { workerDeployments } from "../schema/workers.ts";
import { heartbeat, leader, prune, register } from "./worker-deployments.ts";

const STALE_MS = 45_000;

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

beforeEach(async () => {
	await db.delete(workerDeployments);
});

async function age(
	deploymentId: string,
	column: "first_seen_at" | "last_heartbeat_at",
	seconds: number,
): Promise<void> {
	const target =
		column === "first_seen_at"
			? { firstSeenAt: sql`now() - make_interval(secs => ${seconds})` }
			: { lastHeartbeatAt: sql`now() - make_interval(secs => ${seconds})` };
	await db
		.update(workerDeployments)
		.set(target)
		.where(eq(workerDeployments.deploymentId, deploymentId));
}

async function firstSeen(deploymentId: string): Promise<Date | undefined> {
	const [found] = await db
		.select({ firstSeenAt: workerDeployments.firstSeenAt })
		.from(workerDeployments)
		.where(eq(workerDeployments.deploymentId, deploymentId));
	return found?.firstSeenAt;
}

describe("worker deployment fence", () => {
	test("an empty table has no leader", async () => {
		expect(await leader(db, STALE_MS)).toBeNull();
	});

	test("the newest registered deployment leads", async () => {
		await register(db, "old");
		await age("old", "first_seen_at", 600);
		await register(db, "new");
		expect(await leader(db, STALE_MS)).toBe("new");
	});

	test("a restarted old deployment keeps its first_seen_at and stays non-leader", async () => {
		await register(db, "old");
		await age("old", "first_seen_at", 600);
		await register(db, "new");
		const before = await firstSeen("old");
		await register(db, "old");
		expect(await firstSeen("old")).toEqual(before);
		expect(await leader(db, STALE_MS)).toBe("new");
	});

	test("a stale newest deployment yields leadership to the older live one", async () => {
		await register(db, "old");
		await age("old", "first_seen_at", 600);
		await register(db, "new");
		await age("new", "last_heartbeat_at", 120);
		expect(await leader(db, STALE_MS)).toBe("old");
		await heartbeat(db, "new");
		expect(await leader(db, STALE_MS)).toBe("new");
	});

	test("heartbeat on an unknown deployment inserts nothing", async () => {
		await heartbeat(db, "ghost");
		expect(await firstSeen("ghost")).toBeUndefined();
	});

	test("prune deletes only long-dead rows", async () => {
		await register(db, "dead");
		await register(db, "live");
		await age("dead", "last_heartbeat_at", 2 * 86_400);
		expect(await prune(db, 86_400_000)).toBe(1);
		expect(await firstSeen("dead")).toBeUndefined();
		expect(await firstSeen("live")).toBeInstanceOf(Date);
	});
});
