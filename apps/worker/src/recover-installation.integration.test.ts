import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	installationAccessServices,
	orgServices,
	RECOVER_INSTALLATION_QUEUE,
	recoverInstallationOptions,
	repoServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import type { UserInstallationAccess } from "@tripwire/forge-github";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import {
	type InstallationLookup,
	recoverInstallation,
} from "./jobs/recover-installation.ts";
import type { InstallFailure } from "./report-install-failure.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let boss: PgBoss;
const logger = pino({ level: "silent" });

async function seedUser(input: {
	id: string;
	githubId: string;
	accessToken: string | null;
	expiresAt?: Date;
}): Promise<void> {
	await db.insert(schema.user).values({
		id: input.id,
		name: input.id,
		email: `${input.id}@example.com`,
	});
	await db.insert(schema.account).values({
		id: `acct-${input.id}`,
		userId: input.id,
		providerId: "github",
		accountId: input.githubId,
		accessToken: input.accessToken,
		accessTokenExpiresAt: input.expiresAt,
	});
}

function lookup(input: {
	found: boolean;
	access: UserInstallationAccess;
	calls?: string[];
}): InstallationLookup {
	return {
		getInstallation: (id) => {
			input.calls?.push(`installation:${id}`);
			return Promise.resolve(
				input.found
					? { account: "acme-corp", accountType: "Organization" }
					: null,
			);
		},
		listRepositories: (id) => {
			input.calls?.push(`repos:${id}`);
			return Promise.resolve([
				{
					externalId: `ext-${id}`,
					owner: "acme-corp",
					name: `app-${id}`,
					fullName: `acme-corp/app-${id}`,
					private: true,
				},
			]);
		},
		userInstallations: (token) => {
			input.calls?.push(`user:${token}`);
			return Promise.resolve(input.access);
		},
	};
}

function run(github: InstallationLookup | null, userId: string, id: string) {
	const reports: InstallFailure[] = [];
	const result = recoverInstallation(
		{ db, github, logger, report: (failure) => reports.push(failure) },
		{ userId, installationId: id },
	);
	return { result, reports };
}

function status(userId: string, installationId: string) {
	return orgServices.resolveInstallStatus(db, {
		userId,
		installationId,
		stateOrgId: null,
	});
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	await seedUser({ id: "admin", githubId: "1001", accessToken: "gho_admin" });
	await seedUser({ id: "nobody", githubId: "1002", accessToken: null });
	await seedUser({
		id: "stale",
		githubId: "1003",
		accessToken: "ghu_stale",
		expiresAt: new Date(Date.now() - 60_000),
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("recover-installation", () => {
	test("a 404 from GitHub records not-for-tripwire", async () => {
		const job = run(
			lookup({
				found: false,
				access: { status: "listed", installationIds: [] },
			}),
			"admin",
			"501",
		);
		expect(await job.result).toBe("not-for-tripwire");
		expect(job.reports).toEqual([
			{
				state: "not-for-tripwire",
				installationId: "501",
				userId: "admin",
				error: undefined,
			},
		]);
		expect(await status("admin", "501")).toMatchObject({
			status: "not-for-tripwire",
		});
		expect(
			await repoServices.getRepoByFullName(db, "acme-corp/app-501", "github"),
		).toBe(null);
	});

	test("found and listed: repos sync and the user may claim", async () => {
		const calls: string[] = [];
		const job = run(
			lookup({
				found: true,
				access: { status: "listed", installationIds: ["9", "502"] },
				calls,
			}),
			"admin",
			"502",
		);
		expect(await job.result).toBe("granted");
		expect(job.reports).toEqual([]);
		expect(calls).toEqual(["installation:502", "repos:502", "user:gho_admin"]);
		const repo = await repoServices.getRepoByFullName(
			db,
			"acme-corp/app-502",
			"github",
		);
		expect(repo).toMatchObject({ installationId: "502", orgId: null });
		expect(
			await orgServices.userCanClaimInstallation(db, {
				userId: "admin",
				forge: "github",
				installationId: "502",
			}),
		).toBe(true);
		expect(await status("admin", "502")).toMatchObject({
			status: "claimable",
			account: "acme-corp",
			repoCount: 1,
		});
	});

	test("found but not listed for the user records denied", async () => {
		const job = run(
			lookup({
				found: true,
				access: { status: "listed", installationIds: [] },
			}),
			"admin",
			"503",
		);
		expect(await job.result).toBe("denied");
		expect(await status("admin", "503")).toEqual({
			installationId: "503",
			forge: "github",
			status: "not-yours",
			recoverable: false,
		});
	});

	test("a missing, expired or rejected user token records token-expired", async () => {
		const listed = lookup({
			found: true,
			access: { status: "listed", installationIds: ["504"] },
		});
		const missing = run(listed, "nobody", "504");
		expect(await missing.result).toBe("token-expired");
		expect(missing.reports.map((r) => r.state)).toEqual(["token-expired"]);
		expect(await run(listed, "stale", "504").result).toBe("token-expired");
		expect(
			await run(
				lookup({ found: true, access: { status: "unauthorized" } }),
				"admin",
				"504",
			).result,
		).toBe("token-expired");
		expect(await status("admin", "504")).toMatchObject({
			status: "token-expired",
		});
	});

	test("errors record failed and report, without throwing", async () => {
		const broken: InstallationLookup = {
			...lookup({
				found: true,
				access: { status: "listed", installationIds: [] },
			}),
			getInstallation: () => Promise.reject(new Error("GitHub 502")),
		};
		const job = run(broken, "admin", "505");
		expect(await job.result).toBe("failed");
		expect(job.reports).toEqual([
			{
				state: "recovery-failed",
				installationId: "505",
				userId: "admin",
				error: "GitHub 502",
			},
		]);
		const forbidden = run(
			lookup({ found: true, access: { status: "forbidden" } }),
			"admin",
			"506",
		);
		expect(await forbidden.result).toBe("failed");
		expect(forbidden.reports.map((r) => r.state)).toEqual(["unverifiable"]);
		expect(await run(null, "admin", "507").result).toBe("failed");
		expect(await status("admin", "505")).toMatchObject({
			status: "missing",
			recoverable: false,
		});
	});

	test("running twice is idempotent", async () => {
		const github = lookup({
			found: true,
			access: { status: "listed", installationIds: ["508"] },
		});
		await run(github, "admin", "508").result;
		await run(github, "admin", "508").result;
		const rows = await db
			.select()
			.from(schema.repos)
			.where(eq(schema.repos.installationId, "508"));
		expect(rows).toHaveLength(1);
		const checks = await db
			.select()
			.from(schema.installationAccessChecks)
			.where(eq(schema.installationAccessChecks.installationId, "508"));
		expect(checks).toHaveLength(1);
		expect(
			await installationAccessServices.getFreshInstallAccessCheck(db, {
				userId: "admin",
				forge: "github",
				installationId: "508",
			}),
		).toMatchObject({ result: "granted" });
	});

	test("the queue holds one waiting recovery per user and installation", async () => {
		const job = { userId: "admin", installationId: "509" };
		const first = await boss.send(
			RECOVER_INSTALLATION_QUEUE,
			job,
			recoverInstallationOptions(job),
		);
		const second = await boss.send(
			RECOVER_INSTALLATION_QUEUE,
			job,
			recoverInstallationOptions(job),
		);
		const other = { userId: "nobody", installationId: "509" };
		const third = await boss.send(
			RECOVER_INSTALLATION_QUEUE,
			other,
			recoverInstallationOptions(other),
		);
		expect(first).not.toBeNull();
		expect(second).toBeNull();
		expect(third).not.toBeNull();
	});
});
