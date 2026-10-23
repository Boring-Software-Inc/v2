import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { oauthConsent, setupRuns } from "../schema/oauth.ts";
import { organization } from "../schema/organizations.ts";
import {
	agentGrantExpired,
	ensurePublicAgentClient,
	getAgentGrant,
	listConnectedAgents,
	removeOrgFromAgentGrants,
	revokeAgent,
	saveAgentGrant,
} from "./agents.ts";
import {
	ensureSetupRun,
	getSetupStatus,
	reportSetupProgress,
} from "./setup.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const userId = generateId();
const otherUserId = generateId();
const orgId = generateId();
const otherOrgId = generateId();
const CLIENT = "tripwire-cli";

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	await db.insert(user).values([
		{ id: userId, name: "ada", email: "ada@example.com" },
		{ id: otherUserId, name: "bob", email: "bob@example.com" },
	]);
	await db.insert(organization).values([
		{ id: orgId, name: "acme", slug: "acme", isPersonal: false },
		{ id: otherOrgId, name: "beta", slug: "beta", isPersonal: false },
	]);
	await ensurePublicAgentClient(db, {
		clientId: CLIENT,
		name: "Tripwire CLI",
		scopes: ["openid", "tripwire:read"],
		grantTypes: ["urn:ietf:params:oauth:grant-type:device_code"],
		resource: {
			identifier: "http://localhost:3421/mcp",
			name: "Tripwire MCP",
			allowedScopes: ["tripwire:read"],
		},
	});
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("setup runs", () => {
	test("ensureSetupRun reuses the live run for the same org and user", async () => {
		const first = await ensureSetupRun(db, { orgId, userId });
		const second = await ensureSetupRun(db, { orgId, userId });
		expect(first.code).toMatch(/^[A-Za-z0-9]{10}$/);
		expect(second.code).toBe(first.code);
	});

	test("progress records for the run owner and fills skipped earlier stages", async () => {
		const run = await ensureSetupRun(db, { orgId, userId });
		const result = await reportSetupProgress(db, {
			userId,
			orgIds: [orgId],
			progress: {
				runCode: `acme#${run.code}`,
				stage: "install_app",
				status: "waiting",
				detail: "Waiting for the GitHub App install.",
			},
		});
		expect(result).toEqual({ recorded: true, continueUpdates: true });
		const rows = await db
			.select()
			.from(setupRuns)
			.where(eq(setupRuns.code, run.code));
		const stages = rows[0]?.stages as Record<string, { status: string }>;
		expect(stages.connect_mcp?.status).toBe("skipped");
		expect(stages.install_app?.status).toBe("waiting");
	});

	test("progress from another user or an org outside the token is dropped", async () => {
		const run = await ensureSetupRun(db, { orgId, userId });
		const progress = {
			runCode: run.code,
			stage: "sync_repos" as const,
			status: "active" as const,
		};
		expect(
			await reportSetupProgress(db, {
				userId: otherUserId,
				orgIds: [orgId],
				progress,
			}),
		).toEqual({ recorded: false, continueUpdates: false });
		expect(
			await reportSetupProgress(db, {
				userId,
				orgIds: [otherOrgId],
				progress,
			}),
		).toEqual({ recorded: false, continueUpdates: false });
		expect(
			await reportSetupProgress(db, {
				userId,
				orgIds: [orgId],
				progress: { ...progress, runCode: "not a code" },
			}),
		).toEqual({ recorded: false, continueUpdates: false });
	});

	test("verify_check completed ends the run", async () => {
		const run = await ensureSetupRun(db, { orgId, userId });
		const done = await reportSetupProgress(db, {
			userId,
			orgIds: [orgId],
			progress: {
				runCode: run.code,
				stage: "verify_check",
				status: "completed",
			},
		});
		expect(done).toEqual({ recorded: true, continueUpdates: false });
		const after = await reportSetupProgress(db, {
			userId,
			orgIds: [orgId],
			progress: { runCode: run.code, stage: "verify_check", status: "active" },
		});
		expect(after.recorded).toBe(false);
	});

	test("setup status starts at the install step", async () => {
		const status = await getSetupStatus(db, otherOrgId);
		expect(status).toEqual({
			hasInstallation: false,
			repos: [],
			nextStep: "install_app",
		});
	});
});

describe("agent grants", () => {
	test("save, list, drop an org, and revoke", async () => {
		await saveAgentGrant(db, {
			userId,
			clientId: CLIENT,
			orgIds: [orgId, otherOrgId],
		});
		const grant = await getAgentGrant(db, { userId, clientId: CLIENT });
		expect(grant?.orgIds).toEqual([orgId, otherOrgId]);
		expect(grant && agentGrantExpired(grant)).toBe(false);
		const agents = await listConnectedAgents(db, userId);
		expect(agents.map((a) => a.name)).toEqual(["Tripwire CLI"]);
		expect(agents[0]?.orgs.map((o) => o.slug).sort()).toEqual(["acme", "beta"]);
		expect(await removeOrgFromAgentGrants(db, otherOrgId)).toBe(1);
		expect(
			(await getAgentGrant(db, { userId, clientId: CLIENT }))?.orgIds,
		).toEqual([orgId]);
		await db.insert(oauthConsent).values({
			id: generateId(),
			clientId: CLIENT,
			userId,
			scopes: ["tripwire:read"],
		});
		await revokeAgent(db, { userId, clientId: CLIENT });
		expect(await getAgentGrant(db, { userId, clientId: CLIENT })).toBeNull();
		const consents = await db
			.select()
			.from(oauthConsent)
			.where(eq(oauthConsent.userId, userId));
		expect(consents).toEqual([]);
	});

	test("a grant older than 30 days is expired", () => {
		expect(
			agentGrantExpired(
				{
					userId,
					clientId: CLIENT,
					orgIds: [],
					createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
				},
				new Date(),
			),
		).toBe(true);
	});
});
