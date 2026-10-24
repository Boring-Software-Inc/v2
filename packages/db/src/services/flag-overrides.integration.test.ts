import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	type DatabuddyFlag,
	isTripwireRule,
	TRIPWIRE_RULE_FIELD,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import { userFlagOverrides } from "../schema/staff.ts";
import {
	FLAG_MISSING_MESSAGE,
	listActiveOverrideFlagKeys,
	listFlagOverrideHistory,
	listUserFlagOverrides,
	markFlagOverridePending,
	setUserFlagOverride,
	syncFlagOverrides,
} from "./flag-overrides.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const theirRules = [
	{
		type: "email",
		operator: "ends_with",
		value: "@lumenlabs.dev",
		enabled: true,
		batch: false,
	},
	{
		type: "user_id",
		operator: "in",
		values: ["someone-else"],
		enabled: false,
		batch: false,
	},
];

class FakeDatabuddy {
	flags = new Map<string, DatabuddyFlag>();
	updates = 0;
	failNext: string | null = null;

	seed(key: string, rules: unknown[]) {
		this.flags.set(key, {
			id: `id-${key}`,
			key,
			rules: structuredClone(rules),
		});
	}

	rulesOf(key: string): unknown[] {
		return this.flags.get(key)?.rules ?? [];
	}

	async getFlagByKey(key: string) {
		if (this.failNext) {
			const message = this.failNext;
			this.failNext = null;
			throw new Error(message);
		}
		const flag = this.flags.get(key);
		return flag ? structuredClone(flag) : null;
	}

	async updateFlagRules(id: string, rules: unknown[]) {
		for (const flag of this.flags.values()) {
			if (flag.id === id) {
				flag.rules = structuredClone(rules);
				this.updates++;
				return structuredClone(flag);
			}
		}
		throw new Error("unknown flag id");
	}
}

async function seedUser(name: string): Promise<string> {
	const id = generateId();
	await db.insert(user).values({ id, name, email: `${name}@example.com` });
	return id;
}

let staff: string;

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	staff = await seedUser("grim");
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

let fake: FakeDatabuddy;

beforeEach(async () => {
	await db.delete(userFlagOverrides);
	fake = new FakeDatabuddy();
});

describe("setUserFlagOverride", () => {
	test("records who changed what, from what, to what", async () => {
		const mara = await seedUser("mara-history");
		const first = await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		expect(first).toEqual({ changed: true, from: "default", to: "on" });
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "off",
			actorId: staff,
		});
		const again = await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "off",
			actorId: staff,
		});
		expect(again.changed).toBe(false);

		const history = await listFlagOverrideHistory(db, mara);
		expect(history.map((h) => [h.from, h.to, h.actorName])).toEqual([
			["on", "off", "grim"],
			["default", "on", "grim"],
		]);
		const [row] = await listUserFlagOverrides(db, mara);
		expect(row).toMatchObject({ choice: "off", syncStatus: "pending" });
	});

	test("reset to default keeps a row so the removal can sync", async () => {
		const mara = await seedUser("mara-reset");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "access-gate",
			choice: "on",
			actorId: staff,
		});
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "access-gate",
			choice: "default",
			actorId: staff,
		});
		const rows = await listUserFlagOverrides(db, mara);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.choice).toBe("default");
		expect(await listActiveOverrideFlagKeys(db, mara)).toEqual([]);
	});
});

describe("syncFlagOverrides", () => {
	test("writes Tripwire rules and keeps every rule Tripwire does not own", async () => {
		fake.seed("show-sidebar", theirRules);
		const on = await seedUser("on-user");
		const off = await seedUser("off-user");
		await setUserFlagOverride(db, {
			userId: on,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		await setUserFlagOverride(db, {
			userId: off,
			flagKey: "show-sidebar",
			choice: "off",
			actorId: staff,
		});

		const result = await syncFlagOverrides(db, fake, "show-sidebar");
		expect(result).toEqual({ status: "synced", rows: 2, on: 1, off: 1 });

		const rules = fake.rulesOf("show-sidebar");
		expect(rules.filter((r) => !isTripwireRule(r))).toEqual(theirRules);
		expect(rules).toContainEqual(
			expect.objectContaining({
				field: TRIPWIRE_RULE_FIELD.on,
				values: [on],
				enabled: true,
			}),
		);
		expect(rules).toContainEqual(
			expect.objectContaining({
				field: TRIPWIRE_RULE_FIELD.off,
				values: [off],
				enabled: false,
			}),
		);
		const statuses = (await db.select().from(userFlagOverrides)).map(
			(r) => r.syncStatus,
		);
		expect(statuses).toEqual(["synced", "synced"]);
	});

	test("a reset removes the user from the Tripwire rule on the next sync", async () => {
		fake.seed("show-sidebar", theirRules);
		const mara = await seedUser("mara-removal");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		await syncFlagOverrides(db, fake, "show-sidebar");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "default",
			actorId: staff,
		});
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(fake.rulesOf("show-sidebar")).toEqual(theirRules);
	});

	test("rules added in Databuddy between syncs survive the next sync", async () => {
		fake.seed("show-sidebar", []);
		const mara = await seedUser("mara-concurrent-rule");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		await syncFlagOverrides(db, fake, "show-sidebar");
		const added = {
			type: "property",
			operator: "exists",
			field: "beta",
			enabled: true,
			batch: false,
		};
		const flag = fake.flags.get("show-sidebar");
		flag?.rules?.push(added);
		await markFlagOverridePending(db, {
			userId: mara,
			flagKey: "show-sidebar",
		});
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(fake.rulesOf("show-sidebar")).toContainEqual(added);
		expect(fake.rulesOf("show-sidebar").filter(isTripwireRule)).toHaveLength(1);
	});

	test("a Databuddy failure marks rows failed with the reason", async () => {
		fake.seed("show-sidebar", theirRules);
		const mara = await seedUser("mara-fail");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		fake.failNext = "Databuddy answered 503";
		const result = await syncFlagOverrides(db, fake, "show-sidebar");
		expect(result).toEqual({
			status: "failed",
			error: "Databuddy answered 503",
		});
		const [row] = await listUserFlagOverrides(db, mara);
		expect(row).toMatchObject({
			syncStatus: "failed",
			syncError: "Databuddy answered 503",
		});
		expect(fake.rulesOf("show-sidebar")).toEqual(theirRules);

		const retried = await syncFlagOverrides(db, fake, "show-sidebar");
		expect(retried.status).toBe("synced");
		const [after] = await listUserFlagOverrides(db, mara);
		expect(after).toMatchObject({ syncStatus: "synced", syncError: null });
	});

	test("a flag missing in Databuddy fails without writing", async () => {
		const mara = await seedUser("mara-missing");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "not-a-flag",
			choice: "on",
			actorId: staff,
		});
		expect(await syncFlagOverrides(db, fake, "not-a-flag")).toEqual({
			status: "missing",
		});
		const [row] = await listUserFlagOverrides(db, mara);
		expect(row?.syncError).toBe(FLAG_MISSING_MESSAGE);
		expect(fake.updates).toBe(0);
	});

	test("a change made during a sync stays pending for the next one", async () => {
		fake.seed("show-sidebar", []);
		const mara = await seedUser("mara-race");
		await setUserFlagOverride(db, {
			userId: mara,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		const original = fake.getFlagByKey.bind(fake);
		fake.getFlagByKey = async (key: string) => {
			await setUserFlagOverride(db, {
				userId: mara,
				flagKey: "show-sidebar",
				choice: "off",
				actorId: staff,
			});
			return await original(key);
		};
		await syncFlagOverrides(db, fake, "show-sidebar");
		const [row] = await db
			.select()
			.from(userFlagOverrides)
			.where(eq(userFlagOverrides.userId, mara));
		expect(row?.syncStatus).toBe("pending");
		expect(row?.value).toBe(false);
	});

	test("deleting a user drops their overrides so the next sync removes them", async () => {
		fake.seed("show-sidebar", theirRules);
		const gone = await seedUser("gone-user");
		await setUserFlagOverride(db, {
			userId: gone,
			flagKey: "show-sidebar",
			choice: "on",
			actorId: staff,
		});
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(fake.rulesOf("show-sidebar").filter(isTripwireRule)).toHaveLength(1);
		await db.delete(user).where(eq(user.id, gone));
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(fake.rulesOf("show-sidebar")).toEqual(theirRules);
	});
});
