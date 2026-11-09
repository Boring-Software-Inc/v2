import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolveOrgAccess } from "@tripwire/auth/org-gate";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	type createDb,
	createTestDatabase,
	repoServices,
	runServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import type { AnalyticsEvent } from "#/lib/analytics-events";
import { analyticsActivityHandler } from "#/lib/server/analytics-activity";
import { getDb } from "#/lib/server/db";

let database: TestDatabase;
let pool: ReturnType<typeof createDb>["pool"];
const previousDatabaseUrl = process.env.DATABASE_URL;
const userId = generateId();
const orgId = generateId();
const foreignOrgId = generateId();
const orgSlug = `analytics-${orgId}`;
const ids: Record<string, string> = {};

beforeAll(async () => {
	database = await createTestDatabase();
	process.env.DATABASE_URL = database.url;
	const { db, pool: testPool } = getDb();
	pool = testPool;
	await applyMigrations(db);
	await db.insert(schema.user).values({
		id: userId,
		name: "analytics tester",
		email: `${userId}@example.test`,
	});
	await db.insert(schema.organization).values([
		{ id: orgId, name: "Authorized", slug: orgSlug },
		{ id: foreignOrgId, name: "Private", slug: `private-${orgId}` },
	]);
	await db
		.insert(schema.member)
		.values({ id: generateId(), organizationId: orgId, userId, role: "admin" });
	for (const forge of ["github", "opengit"] as const) {
		await repoServices.ensureRepo(db, {
			forge,
			externalId: generateId(),
			owner: "same-owner",
			name: "widget",
			fullName: "same-owner/widget",
			private: true,
			orgId: forge === "opengit" ? orgId : foreignOrgId,
		});
		for (const verdict of ["block", "pass", "needs_review"] as const) {
			const eventId = generateId();
			await db.insert(schema.events).values({
				id: eventId,
				forge,
				deliveryId: eventId,
				rawKind: "database-test",
				raw: {},
				kind: "change-request.opened",
				actorLogin: `${forge}-${verdict}`,
			});
			ids[`${forge}-${verdict}`] = await runServices.createRun(db, {
				eventId,
				repoFullName: "same-owner/widget",
				subjectNumber: forge === "github" ? 91 : 42,
				headSha: null,
				snapshot: [DEFAULT_WORKFLOW],
				status: "completed",
				verdict,
			});
		}
	}
}, 120_000);

afterAll(async () => {
	await pool?.end();
	await database?.stop();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
});

test("analytics activity handler keeps the authorized forge for every metric", async () => {
	const { db } = getDb();
	const access = await resolveOrgAccess(db, {
		userId,
		orgSlug,
		requirement: { kind: "permission", permission: "analytics:read" },
	});
	expect(access.ok).toBe(true);
	if (!access.ok) throw new Error("test org access denied");
	const output: Partial<
		Record<"blocked" | "passed" | "review", AnalyticsEvent[]>
	> = {};
	for (const metric of ["blocked", "passed", "review"] as const) {
		const result = await analyticsActivityHandler({
			data: { org: orgSlug, repo: "widget", metric },
			context: { org: access.org },
		});
		output[metric] = result;
	}
	if (process.env.PR124_EVIDENCE)
		await Bun.write(
			`/tmp/pr124-analytics-${process.env.PR124_EVIDENCE}.json`,
			JSON.stringify(
				{
					fixture: { orgSlug, fullName: "same-owner/widget", ids },
					activity: output,
				},
				null,
				2,
			),
		);
	for (const [metric, verdict] of [
		["blocked", "block"],
		["passed", "pass"],
		["review", "needs_review"],
	] as const) {
		const result = output[metric];
		expect(Array.isArray(result) && result.map((row) => row.id)).toEqual([
			ids[`opengit-${verdict}`],
		]);
	}
});
