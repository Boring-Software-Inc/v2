import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RULE_CATALOG } from "@tripwire/contracts";
import { sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import * as repoServices from "./repos.ts";

const LEGACY_DEFAULTS = [
	"account-age",
	"crypto-address",
	"honeypot",
	"max-files-changed",
	"english-only",
];

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let backfill: string;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	backfill = await readFile(
		fileURLToPath(
			new URL("../../drizzle/0039_rules_off_by_default.sql", import.meta.url),
		),
		"utf8",
	);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

test("existing repos keep the rules that ran by default, and nothing else changes", async () => {
	const fresh = await repoServices.ensureRepo(db, {
		externalId: "1",
		owner: "acme",
		name: "fresh",
		fullName: "acme/fresh",
	});
	const tuned = await repoServices.ensureRepo(db, {
		externalId: "2",
		owner: "acme",
		name: "tuned",
		fullName: "acme/tuned",
	});
	const openGit = await repoServices.ensureRepo(db, {
		forge: "opengit",
		externalId: "3",
		owner: "acme",
		name: "elsewhere",
		fullName: "acme/elsewhere",
	});
	await repoServices.upsertRuleConfig(db, tuned, {
		ruleId: "account-age",
		version: 1,
		enabled: false,
		config: { minDays: 30 },
	});
	await repoServices.upsertRuleConfig(db, tuned, {
		ruleId: "honeypot",
		version: 1,
		enabled: true,
		config: { paths: ["secrets/**"] },
	});

	await db.execute(sql.raw(backfill));
	await db.execute(sql.raw(backfill));

	const freshRows = await repoServices.listRuleConfigs(db, fresh);
	expect(freshRows.map((row) => row.ruleId).sort()).toEqual(
		[...LEGACY_DEFAULTS].sort(),
	);
	for (const row of freshRows) {
		const entry = RULE_CATALOG.find((rule) => rule.ruleId === row.ruleId);
		expect(row.enabled).toBe(true);
		expect(row.version).toBe(entry?.version ?? -1);
		expect(row.config).toEqual(entry?.defaultConfig ?? null);
	}

	const tunedRows = await repoServices.listRuleConfigs(db, tuned);
	expect(tunedRows).toHaveLength(LEGACY_DEFAULTS.length);
	expect(tunedRows.find((row) => row.ruleId === "account-age")).toEqual({
		ruleId: "account-age",
		version: 1,
		enabled: false,
		config: { minDays: 30 },
	});
	expect(tunedRows.find((row) => row.ruleId === "honeypot")?.config).toEqual({
		paths: ["secrets/**"],
	});

	const openGitRows = await repoServices.listRuleConfigs(db, openGit);
	expect(openGitRows.map((row) => row.ruleId)).toEqual(["english-only"]);

	const ids = await db.execute(sql`SELECT id FROM rule_configs`);
	for (const row of ids.rows as { id: string }[]) {
		expect(row.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	}
});
