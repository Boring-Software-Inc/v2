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
	type JsonValue,
	TRIPWIRE_RULE_FIELD,
} from "@tripwire/contracts";
import { generateId, getDatabuddyUserOverride } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import { userFlagOverrides } from "../schema/staff.ts";
import { deleteUserAccount } from "./account-deletion.ts";
import {
	FLAG_MISSING_MESSAGE,
	listFlagOverrideHistory,
	listPendingFlagRemovals,
	listUserFlagOverrides,
	markFlagOverridePending,
	setUserFlagOverride,
	syncFlagOverrides,
} from "./flag-overrides.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let staff: string;
const theirEmailRule = {
	type: "email",
	operator: "ends_with",
	value: "@lumenlabs.dev",
	enabled: true,
	batch: false,
};
const theirUserRule = {
	type: "user_id",
	operator: "in",
	values: ["someone-else"],
	enabled: false,
	batch: false,
};
const theirRules = [theirEmailRule, theirUserRule];

class FakeDatabuddy {
	flags = new Map<string, DatabuddyFlag>();
	updates = 0;
	failNext: string | null = null;
	failWrite = false;
	confirmWrite = true;
	omitWriteRules = false;
	seed(key: string, rules: JsonValue[]) {
		this.flags.set(key, {
			id: `id-${key}`,
			key,
			rules: structuredClone(rules),
		});
	}
	rulesOf(key: string): JsonValue[] {
		return this.flags.get(key)?.rules ?? [];
	}
	async getFlagByKey(key: string) {
		if (this.failNext) {
			const message = this.failNext;
			this.failNext = null;
			throw new Error(message);
		}
		const flag = this.flags.get(key);
		const snapshot = flag ? structuredClone(flag) : null;
		await new Promise((resolve) => setTimeout(resolve, 5));
		return snapshot;
	}
	async updateFlagRules(id: string, rules: JsonValue[]) {
		if (this.failWrite) throw new Error("Databuddy answered 503");
		for (const flag of this.flags.values()) {
			if (flag.id === id) {
				if (this.confirmWrite) flag.rules = structuredClone(rules);
				this.updates++;
				const response = structuredClone(flag);
				if (this.omitWriteRules) delete response.rules;
				return response;
			}
		}
		throw new Error("unknown flag id");
	}
}
let fake: FakeDatabuddy;
async function seedUser(name: string): Promise<string> {
	const id = generateId();
	await db.insert(user).values({ id, name, email: `${name}@example.com` });
	return id;
}
async function set(
	userId: string,
	choice: "on" | "off" | "default",
	flagKey = "show-sidebar",
) {
	return await setUserFlagOverride(db, fake, {
		userId,
		flagKey,
		choice,
		actorId: staff,
	});
}
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
beforeEach(async () => {
	await db.delete(userFlagOverrides);
	fake = new FakeDatabuddy();
	fake.seed("show-sidebar", theirRules);
});

describe("Databuddy-authoritative overrides", () => {
	test("writes remotely before reporting success and records the real from/to values", async () => {
		const id = await seedUser("history");
		expect(await set(id, "on")).toEqual({
			ok: true,
			changed: true,
			from: "default",
			to: "on",
		});
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), id)).toBe(
			"on",
		);
		expect(await set(id, "off")).toEqual({
			ok: true,
			changed: true,
			from: "on",
			to: "off",
		});
		expect(await set(id, "off")).toEqual({
			ok: true,
			changed: false,
			from: "off",
			to: "off",
		});
		expect(fake.updates).toBe(2);
		expect(
			(await listFlagOverrideHistory(db, id)).map((h) => [
				h.from,
				h.to,
				h.actorName,
			]),
		).toEqual([
			["on", "off", "grim"],
			["default", "on", "grim"],
		]);
		expect((await listUserFlagOverrides(db, id))[0]).toMatchObject({
			choice: "off",
			syncStatus: "synced",
			syncError: null,
		});
		expect(fake.rulesOf("show-sidebar")).toEqual(
			expect.arrayContaining(theirRules),
		);
	});
	test("external On beats cached Off, survives reconciliation, and can be deliberately turned Off again", async () => {
		const id = await seedUser("external");
		await set(id, "off");
		fake.seed("show-sidebar", [
			...theirRules,
			{
				type: "user_id",
				operator: "equals",
				value: id,
				enabled: true,
				batch: false,
			},
		]);
		const external = structuredClone(fake.rulesOf("show-sidebar"));
		const writes = fake.updates;
		expect((await listUserFlagOverrides(db, id))[0]?.choice).toBe("off");
		expect(getDatabuddyUserOverride(external, id)).toBe("on");
		await markFlagOverridePending(db, { userId: id, flagKey: "show-sidebar" });
		expect(await syncFlagOverrides(db, fake, "show-sidebar")).toEqual({
			status: "synced",
			rows: 1,
			on: 1,
			off: 0,
		});
		expect(fake.updates).toBe(writes);
		expect(fake.rulesOf("show-sidebar")).toEqual(external);
		expect((await listUserFlagOverrides(db, id))[0]).toMatchObject({
			choice: "on",
			syncStatus: "synced",
		});
		expect(await set(id, "off")).toEqual({
			ok: true,
			changed: true,
			from: "on",
			to: "off",
		});
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), id)).toBe(
			"off",
		);
	});
	test("a cached Off never suppresses an explicit write of Off after external On", async () => {
		const id = await seedUser("same-local-choice");
		await set(id, "off");
		fake.seed("show-sidebar", [
			{
				type: "user_id",
				operator: "in",
				values: [id, "external-member"],
				batch: false,
				enabled: true,
			},
		]);
		expect(await set(id, "off")).toEqual({
			ok: true,
			changed: true,
			from: "on",
			to: "off",
		});
		expect(
			getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), "external-member"),
		).toBe("on");
		expect((await listFlagOverrideHistory(db, id))[0]).toMatchObject({
			from: "on",
			to: "off",
		});
	});
	test("external removal remains Default instead of recreating a cached rule", async () => {
		const id = await seedUser("removed-externally");
		await set(id, "on");
		fake.seed("show-sidebar", theirRules);
		const writes = fake.updates;
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(fake.updates).toBe(writes);
		expect(fake.rulesOf("show-sidebar")).toEqual(theirRules);
		expect((await listUserFlagOverrides(db, id))[0]?.choice).toBe("default");
	});
	test("Default clears the selected user only, including explicit manual membership", async () => {
		const id = await seedUser("reset");
		fake.seed("show-sidebar", [
			...theirRules,
			{
				type: "user_id",
				operator: "in",
				values: [id, "keep-me"],
				enabled: true,
				batch: false,
				note: "manual",
			},
		]);
		expect(await set(id, "default")).toEqual({
			ok: true,
			changed: true,
			from: "on",
			to: "default",
		});
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), id)).toBe(
			"default",
		);
		expect(
			getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), "keep-me"),
		).toBe("on");
		expect(fake.rulesOf("show-sidebar")).toContainEqual({
			type: "user_id",
			operator: "in",
			values: ["keep-me"],
			enabled: true,
			batch: false,
			note: "manual",
		});
	});
	test("serializes concurrent Tripwire edits so neither user's membership is lost", async () => {
		const a = await seedUser("concurrent-a"),
			b = await seedUser("concurrent-b");
		const results = await Promise.all([set(a, "on"), set(b, "off")]);
		expect(results.every((result) => result.ok)).toBe(true);
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), a)).toBe(
			"on",
		);
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), b)).toBe(
			"off",
		);
		expect(fake.rulesOf("show-sidebar")).toEqual(
			expect.arrayContaining(theirRules),
		);
	});
	test("a failed remote write does not persist a new desired state or success history", async () => {
		const id = await seedUser("write-failure");
		fake.failWrite = true;
		expect(await set(id, "on")).toEqual({
			ok: false,
			error: "Databuddy answered 503",
		});
		expect(await listUserFlagOverrides(db, id)).toEqual([]);
		expect(await listFlagOverrideHistory(db, id)).toEqual([]);
		expect(fake.rulesOf("show-sidebar")).toEqual(theirRules);
	});
	test("unconfirmed and incomplete remote responses fail closed", async () => {
		const id = await seedUser("unconfirmed");
		fake.confirmWrite = false;
		expect((await set(id, "on")).ok).toBe(false);
		expect(await listUserFlagOverrides(db, id)).toEqual([]);
		fake.flags.set("show-sidebar", { id: "f-incomplete", key: "show-sidebar" });
		const writes = fake.updates;
		expect((await set(id, "on")).ok).toBe(false);
		expect((await syncFlagOverrides(db, fake, "show-sidebar")).status).toBe(
			"failed",
		);
		expect(fake.updates).toBe(writes);
	});
	test("an incomplete reset response is not mistaken for confirmation of Default", async () => {
		const id = await seedUser("incomplete-reset");
		await set(id, "on");
		fake.omitWriteRules = true;
		expect((await set(id, "default")).ok).toBe(false);
		expect((await listUserFlagOverrides(db, id))[0]?.choice).toBe("on");
	});

	test("an incomplete deletion response retains the durable cleanup record", async () => {
		const id = await seedUser("incomplete-cleanup");
		await set(id, "on");
		await deleteUserAccount(db, id);
		fake.omitWriteRules = true;
		expect((await syncFlagOverrides(db, fake, "show-sidebar")).status).toBe(
			"failed",
		);
		expect(
			await listPendingFlagRemovals(db, new Date(Date.now() + 60_000)),
		).toEqual(["show-sidebar"]);
		fake.omitWriteRules = false;
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(
			await listPendingFlagRemovals(db, new Date(Date.now() + 60_000)),
		).toEqual([]);
	});

	test("missing flags and deleted users cannot create a remote override", async () => {
		const id = await seedUser("missing");
		expect(await set(id, "on", "not-a-flag")).toEqual({
			ok: false,
			error: FLAG_MISSING_MESSAGE,
		});
		expect(await set(generateId(), "on")).toEqual({
			ok: false,
			error: "This user no longer exists.",
		});
		expect(fake.updates).toBe(0);
	});
	test("a failed legacy reconciliation can retry without publishing its cached value", async () => {
		const id = await seedUser("legacy-failure");
		await set(id, "off");
		await markFlagOverridePending(db, { userId: id, flagKey: "show-sidebar" });
		fake.failNext = "Databuddy answered 503";
		expect(await syncFlagOverrides(db, fake, "show-sidebar")).toEqual({
			status: "failed",
			error: "Databuddy answered 503",
		});
		expect((await listUserFlagOverrides(db, id))[0]?.syncStatus).toBe("failed");
		const writes = fake.updates;
		expect((await syncFlagOverrides(db, fake, "show-sidebar")).status).toBe(
			"synced",
		);
		expect(fake.updates).toBe(writes);
	});
	test("missing remote flags fail legacy pending rows without a write", async () => {
		const id = await seedUser("legacy-missing");
		await set(id, "on");
		await markFlagOverridePending(db, { userId: id, flagKey: "show-sidebar" });
		fake.flags.delete("show-sidebar");
		const writes = fake.updates;
		expect(await syncFlagOverrides(db, fake, "show-sidebar")).toEqual({
			status: "missing",
		});
		expect((await listUserFlagOverrides(db, id))[0]?.syncError).toBe(
			FLAG_MISSING_MESSAGE,
		);
		expect(fake.updates).toBe(writes);
	});
});

describe("account-deletion cleanup", () => {
	test("removes only explicitly deleted users and preserves remote users absent from the local cache", async () => {
		const gone = await seedUser("deleted"),
			stays = await seedUser("stays");
		fake.seed("access-gate", []);
		await set(gone, "on");
		await set(gone, "on", "access-gate");
		await set(stays, "off");
		fake.flags.get("show-sidebar")?.rules?.push({
			type: "user_id",
			operator: "in",
			field: TRIPWIRE_RULE_FIELD.on,
			values: ["remote-only"],
			enabled: true,
			batch: false,
		});
		expect((await deleteUserAccount(db, gone)).flagKeys.sort()).toEqual([
			"access-gate",
			"show-sidebar",
		]);
		const later = new Date(Date.now() + 60_000);
		expect((await listPendingFlagRemovals(db, later)).sort()).toEqual([
			"access-gate",
			"show-sidebar",
		]);
		await syncFlagOverrides(db, fake, "access-gate");
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(fake.rulesOf("access-gate")).toEqual([]);
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), gone)).toBe(
			"default",
		);
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), stays)).toBe(
			"off",
		);
		expect(
			getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), "remote-only"),
		).toBe("on");
		expect(fake.rulesOf("show-sidebar")).toEqual(
			expect.arrayContaining(theirRules),
		);
		expect(await listPendingFlagRemovals(db, later)).toEqual([]);
	});
	test("failed cleanup keeps its durable removal for the next sweep", async () => {
		const gone = await seedUser("deleted-retry");
		await set(gone, "off");
		await deleteUserAccount(db, gone);
		fake.failNext = "Databuddy is down";
		expect((await syncFlagOverrides(db, fake, "show-sidebar")).status).toBe(
			"failed",
		);
		const later = new Date(Date.now() + 60_000);
		expect(await listPendingFlagRemovals(db, later)).toEqual(["show-sidebar"]);
		expect(await listPendingFlagRemovals(db, new Date(0))).toEqual([]);
		await syncFlagOverrides(db, fake, "show-sidebar");
		expect(getDatabuddyUserOverride(fake.rulesOf("show-sidebar"), gone)).toBe(
			"default",
		);
		expect(await listPendingFlagRemovals(db, later)).toEqual([]);
	});
});
