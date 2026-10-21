import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	OPEN_REDACTION,
	orgResponseDefaultsSchema,
	responseConfigSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { upsertResponseConfig } from "./repos.ts";
import {
	getOrgRedactionUsage,
	getOrgResponseDefaults,
	getRedactionPolicy,
	upsertOrgResponseDefaults,
} from "./responses.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const orgId = generateId();
const otherOrgId = generateId();

async function seedRepo(name: string, owner: string | null): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: generateId(),
		owner: "acme",
		name,
		fullName: `acme/${name}`,
		orgId: owner,
	});
	return id;
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	await db.insert(organization).values([
		{ id: orgId, name: "acme", slug: "acme", isPersonal: false },
		{ id: otherOrgId, name: "beta", slug: "beta", isPersonal: false },
	]);
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("org response defaults", () => {
	test("an org without a row reads as open", async () => {
		const defaults = await getOrgResponseDefaults(db, otherOrgId);
		expect(defaults.redaction).toEqual(OPEN_REDACTION);
	});

	test("upsert writes once and then updates in place", async () => {
		await upsertOrgResponseDefaults(
			db,
			orgId,
			orgResponseDefaultsSchema.parse({ redaction: { level: 3 } }),
		);
		await upsertOrgResponseDefaults(
			db,
			orgId,
			orgResponseDefaultsSchema.parse({ redaction: { level: 5 } }),
		);
		const defaults = await getOrgResponseDefaults(db, orgId);
		expect(defaults.redaction.level).toBe(5);
	});
});

describe("getRedactionPolicy", () => {
	test("a repo with no config inherits the org default", async () => {
		const repoId = await seedRepo("inherits", orgId);
		const policy = await getRedactionPolicy(db, repoId);
		expect(policy.level).toBe(5);
	});

	test("an override wins over the org default", async () => {
		const repoId = await seedRepo("overrides", orgId);
		await upsertResponseConfig(
			db,
			repoId,
			responseConfigSchema.parse({
				redaction: { inherit: false, level: 8, surfaces: ["comment"] },
			}),
		);
		const policy = await getRedactionPolicy(db, repoId);
		expect(policy).toEqual({
			level: 8,
			surfaces: ["comment"],
			showHelp: true,
		});
	});

	test("an unclaimed repo and a missing repo stay open", async () => {
		const unclaimed = await seedRepo("unclaimed", null);
		expect(await getRedactionPolicy(db, unclaimed)).toEqual(OPEN_REDACTION);
		expect(await getRedactionPolicy(db, null)).toEqual(OPEN_REDACTION);
	});
});

describe("getOrgRedactionUsage", () => {
	test("counts inheriting and overriding repos in the org only", async () => {
		await seedRepo("outsider", otherOrgId);
		const usage = await getOrgRedactionUsage(db, orgId);
		expect(usage).toEqual({ inheriting: 1, overriding: 1 });
	});
});
