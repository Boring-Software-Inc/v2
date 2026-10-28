import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	DEFAULT_WORKFLOW,
	GITCAFE_CONNECT_QUEUE,
	type GitCafeConnectionJob,
	type GitCafeConnectionRepository,
	type GitCafeInstallation,
	type GitCafeOrganizationMembers,
	gitCafeConnectionRepositoryPageSchema,
	gitCafeConnectionRepositorySchema,
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
	gitCafeOrganizationMembersSchema,
	type RepoArmingResult,
} from "@tripwire/contracts";
import {
	account,
	applyMigrations,
	createBoss,
	createDb,
	createGitCafeConnectionBoss,
	createTestDatabase,
	type Db,
	gitCafeConnectionServices,
	member,
	organization,
	organizationInstallations,
	organizationRole,
	orgServices,
	repoServices,
	repos,
	session,
	type TestDatabase,
	user,
	workflowServices,
} from "@tripwire/db";
import { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";
import { generateId, sleep } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import {
	connectGitCafeInstallation,
	type GitCafeConnectionDeps,
} from "./gitcafe-connect.ts";

const fixtureBase = new URL(
	"../../../../packages/forge-gitcafe/fixtures/",
	import.meta.url,
);
const installation = gitCafeInstallationSchema.parse(
	await Bun.file(new URL("gitcafe-installation.json", fixtureBase)).json(),
);
const membership = gitCafeOrganizationMembersSchema.parse(
	await Bun.file(
		new URL("gitcafe-connection-members.json", fixtureBase),
	).json(),
);
const repository = gitCafeConnectionRepositorySchema.parse(
	await Bun.file(
		new URL("gitcafe-connection-repository.json", fixtureBase),
	).json(),
);
const token = gitCafeInstallationTokenSchema.parse(
	await Bun.file(
		new URL("gitcafe-installation-token.json", fixtureBase),
	).json(),
);
const credentials = {
	appId: installation.appId,
	keyId: "local-regression-key",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};

function installedTransport(
	change: {
		lookup?: number;
		installation?: Partial<typeof installation>;
		membersAfterRepo?: GitCafeOrganizationMembers;
	} = {},
) {
	let lookups = 0;
	let repoReads = 0;
	let memberReads = 0;
	let mints = 0;
	let current = installation;
	const client = new GitCafeInstallationClient({
		credentials,
		fetch: async (url, init) => {
			if (url.includes("/api/apps/")) {
				if (init.method === "POST") {
					mints++;
					return Response.json({
						...token,
						token: "local-regression-token",
						expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
						repositories: current.repositories,
						repositorySelection: current.repositorySelection,
					});
				}
				lookups++;
				if (lookups === change.lookup)
					current = { ...installation, ...change.installation };
				return Response.json(current);
			}
			if (url.includes("/members/")) {
				memberReads++;
				return Response.json(
					repoReads === 2 && change.membersAfterRepo
						? change.membersAfterRepo
						: membership,
				);
			}
			if (
				url ===
				`https://git.cafe/api/repos?owner=${repository.owner}&sort=id&limit=50`
			) {
				repoReads++;
				return Response.json({ items: [repository], next: null });
			}
			throw new Error("Unexpected local fixture transport path");
		},
	});
	return { client, counts: () => ({ lookups, repoReads, memberReads, mints }) };
}

/** Synthetic transport variations exercise pagination beyond the single captured scratch page. */
function paginatedTransport(
	selection: "all" | "selected",
	change?: (
		kind: "lookup" | "mint" | "members" | "repos",
		count: number,
		state: {
			installation: GitCafeInstallation;
			repositories: GitCafeConnectionRepository[];
		},
	) => Response | undefined,
) {
	const repositories = Array.from({ length: 151 }, (_, index) => ({
		...repository,
		id: generateId(),
		name: `synthetic-${index}`,
	}));
	const state = {
		installation: {
			...installation,
			repositorySelection: selection,
			repositories:
				selection === "selected" ? repositories.map((repo) => repo.name) : [],
		},
		repositories,
	};
	const counts = { lookup: 0, mint: 0, members: 0, repos: 0 };
	const calls: string[] = [];
	const extraMembers = Array.from({ length: 100 }, () => ({
		actorId: generateId(),
		role: "org-member",
	}));
	const client = new GitCafeInstallationClient({
		credentials,
		fetch: async (url, init) => {
			calls.push(url);
			const kind = url.includes("/api/apps/")
				? init.method === "POST"
					? "mint"
					: "lookup"
				: url.includes("/members/")
					? "members"
					: "repos";
			counts[kind]++;
			const override = change?.(kind, counts[kind], state);
			if (override) return override;
			if (kind === "lookup") return Response.json(state.installation);
			if (kind === "mint")
				return Response.json({
					...token,
					token: "synthetic-installed-token",
					expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
					repositorySelection: selection,
					repositories: state.installation.repositories,
				});
			const after = new URL(url).searchParams.get("after");
			if (kind === "members")
				return Response.json(
					after === null
						? { items: extraMembers, next: "members-final" }
						: membership,
				);
			const offset = after === null ? 0 : Number(after);
			const page = state.repositories.slice(offset, offset + 50);
			return Response.json({
				items: counts.repos > 4 ? page.reverse() : page,
				next:
					offset + 50 < state.repositories.length ? String(offset + 50) : null,
			});
		},
	});
	return { client, state, counts, calls };
}
const actorId = membership.items[0]?.actorId;
if (!actorId) throw new Error("captured staging actor missing");
let container: TestDatabase;
let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let boss: PgBoss;
let job: GitCafeConnectionJob;
let reads: number;
let lookupCount: number;
let changedLookup: () => typeof installation;
let beforeFetch: () => Promise<void>;
let membersResponse: GitCafeOrganizationMembers;
let repositoryResponse: unknown;
let deps: GitCafeConnectionDeps;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 60_000);

beforeEach(async () => {
	await db.execute(sql`TRUNCATE repos, organization, "user" CASCADE`);
	const userId = generateId(),
		sessionId = generateId(),
		orgId = generateId();
	await db.insert(user).values({
		id: userId,
		name: "Local connection initiator",
		email: `${userId}@example.com`,
		accessStatus: "approved",
	});
	await db.insert(session).values({
		id: sessionId,
		userId,
		token: generateId(),
		expiresAt: new Date(Date.now() + 60_000),
	});
	await db.insert(organization).values({
		id: orgId,
		name: "Connection target",
		slug: `target-${orgId}`,
		isPersonal: false,
	});
	await db
		.insert(member)
		.values({ id: generateId(), userId, organizationId: orgId, role: "admin" });
	const reserveAdmin = generateId();
	await db.insert(user).values({
		id: reserveAdmin,
		name: "Retained org admin",
		email: `${reserveAdmin}@example.com`,
		accessStatus: "approved",
	});
	await db.insert(member).values({
		id: generateId(),
		userId: reserveAdmin,
		organizationId: orgId,
		role: "admin",
	});
	job = {
		userId,
		sessionId,
		orgId,
		installationId: installation.id,
		subject: "separate-delegating-subject",
		actorId: actorId ?? "missing",
		authorizedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		requestId: generateId(),
	};
	reads = 0;
	lookupCount = 0;
	changedLookup = () => installation;
	beforeFetch = async () => {};
	membersResponse = membership;
	repositoryResponse = repository;
	deps = {
		db,
		client: {
			getInstallation: async () => {
				lookupCount++;
				return { ok: true, value: changedLookup() };
			},
			getOrganizationMembers: async () => {
				reads++;
				await beforeFetch();
				return { ok: true, value: membersResponse };
			},
			getRepositories: async () => {
				reads++;
				await beforeFetch();
				const parsed = gitCafeConnectionRepositoryPageSchema.safeParse({
					items: [repositoryResponse],
					next: null,
				});
				return parsed.success
					? { ok: true, value: parsed.data.items }
					: { ok: false, reason: "invalid-response" };
			},
		},
	};
});

afterAll(async () => {
	await boss?.stop({ graceful: false });
	await pool?.end();
	await container?.stop();
});

test("explicit bounded action persists first-class GitCafe rows without linking the delegated account", async () => {
	const result = await connectGitCafeInstallation(deps, job);
	expect(result).toEqual({ ok: true, repoCount: 1 });
	const [row] = await db.select().from(repos);
	expect(row).toMatchObject({
		forge: "gitcafe",
		externalId: repository.id,
		fullName: `${repository.owner}/${repository.name}`,
		orgId: job.orgId,
		armed: false,
	});
	expect(
		await orgServices.getOrgRepo(db, {
			orgId: job.orgId,
			repoName: repository.name,
			owner: repository.owner,
			forge: "gitcafe",
		}),
	).not.toBeNull();
	expect(await orgServices.listOrgSwitcherRepos(db, job.orgId)).toHaveLength(1);
	expect(await db.select().from(account)).toHaveLength(0);
	expect(reads).toBe(6);
	expect(lookupCount).toBe(4);
});

test("actual installed client connects captured authority through the real PostgreSQL job", async () => {
	const transport = installedTransport();
	expect(
		await connectGitCafeInstallation({ db, client: transport.client }, job),
	).toEqual({ ok: true, repoCount: 1 });
	expect(transport.counts()).toEqual({
		lookups: 10,
		repoReads: 2,
		memberReads: 4,
		mints: 1,
	});
	expect(await db.select().from(organizationInstallations)).toHaveLength(1);
	expect((await db.select().from(repos))[0]).toMatchObject({
		forge: "gitcafe",
		name: repository.name,
		armed: false,
	});
});

for (const selection of ["all", "selected"] as const) {
	test(`actual worker connects synthetic multi-page ${selection} authority beyond 100 repos and members`, async () => {
		const transport = paginatedTransport(selection);
		expect(
			await connectGitCafeInstallation({ db, client: transport.client }, job),
		).toEqual({ ok: true, repoCount: 151 });
		expect(await db.select().from(repos)).toHaveLength(151);
		expect(transport.counts).toEqual({
			lookup: 20,
			mint: 1,
			members: 8,
			repos: 8,
		});
		expect(
			transport.calls.filter((url) =>
				new URL(url).pathname.startsWith("/api/repos/"),
			),
		).toHaveLength(0);
		expect(await db.select().from(organizationInstallations)).toHaveLength(1);
	});
}

for (const page of [2, 6]) {
	for (const scenario of [
		"failure",
		"selection",
		"generation",
		"changed-set",
		"membership",
	] as const) {
		if (scenario === "changed-set" && page === 2) continue;
		test(`actual worker refuses ${scenario} at repository page ${page} with no claims`, async () => {
			let revoked = false;
			const transport = paginatedTransport("selected", (kind, count, state) => {
				if (kind === "members" && revoked)
					return Response.json({ items: [], next: null });
				if (kind !== "repos" || count !== page) return;
				if (scenario === "failure")
					return new Response("private-detail", { status: 503 });
				if (scenario === "selection")
					state.installation = { ...state.installation, repositories: [] };
				if (scenario === "generation")
					transport.client.invalidate(installation.id);
				if (scenario === "changed-set")
					state.repositories = state.repositories.map((repo, index) =>
						index === 50 ? { ...repo, visibility: "private" } : repo,
					);
				if (scenario === "membership") revoked = true;
			});
			const result = await connectGitCafeInstallation(
				{ db, client: transport.client },
				job,
			);
			expect(result).toEqual({
				ok: false,
				reason:
					scenario === "failure"
						? "repository-mismatch"
						: scenario === "membership"
							? "not-admin"
							: "installation-mismatch",
			});
			expect(await db.select().from(repos)).toHaveLength(0);
			expect(await db.select().from(organizationInstallations)).toHaveLength(0);
		});
	}
}

for (const phase of ["lookup", "mint", "members", "repos"] as const) {
	test(`actual worker reports expired authorization during ${phase} without claiming`, async () => {
		let now = Date.now();
		const clock = spyOn(Date, "now").mockImplementation(() => now);
		try {
			const transport = paginatedTransport("all", (kind) => {
				if (kind === phase) now = job.expiresAt;
				return undefined;
			});
			expect(
				await connectGitCafeInstallation({ db, client: transport.client }, job),
			).toEqual({ ok: false, reason: "expired" });
			expect(await db.select().from(repos)).toHaveLength(0);
			expect(await db.select().from(organizationInstallations)).toHaveLength(0);
		} finally {
			clock.mockRestore();
		}
	});
}

for (const lookup of [5, 10]) {
	for (const change of [
		{ name: "selection revoked", value: { repositories: [] } },
		{
			name: "revision changed",
			value: { revision: installation.revision + 1 },
		},
	]) {
		test(`actual client refuses ${change.name} at final membership token lookup ${lookup} without claiming`, async () => {
			const transport = installedTransport({
				lookup,
				installation: change.value,
			});
			expect(
				await connectGitCafeInstallation({ db, client: transport.client }, job),
			).toEqual({ ok: false, reason: "installation-mismatch" });
			expect(transport.counts().lookups).toBe(lookup);
			expect(transport.counts().memberReads).toBe(lookup === 5 ? 1 : 3);
			expect(transport.counts().mints).toBe(1);
			expect(await db.select().from(organizationInstallations)).toHaveLength(0);
			expect(await db.select().from(repos)).toHaveLength(0);
		});
	}
}

test("actual client refuses membership revoked after the final repository response", async () => {
	const transport = installedTransport({
		membersAfterRepo: { ...membership, items: [] },
	});
	expect(
		await connectGitCafeInstallation({ db, client: transport.client }, job),
	).toEqual({ ok: false, reason: "not-admin" });
	expect(transport.counts().memberReads).toBe(4);
	expect(await db.select().from(organizationInstallations)).toHaveLength(0);
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("same-org concurrent claims are idempotent and another org cannot steal installation or repositories", async () => {
	expect(
		await Promise.all([
			connectGitCafeInstallation(deps, job),
			connectGitCafeInstallation(deps, job),
		]),
	).toEqual([
		{ ok: true, repoCount: 1 },
		{ ok: true, repoCount: 1 },
	]);
	const other = generateId();
	await db.insert(organization).values({
		id: other,
		name: "Other",
		slug: `other-${other}`,
		isPersonal: false,
	});
	await db.insert(member).values({
		id: generateId(),
		userId: job.userId,
		organizationId: other,
		role: "admin",
	});
	expect(
		await connectGitCafeInstallation(deps, { ...job, orgId: other }),
	).toEqual({ ok: false, reason: "ownership-conflict" });
	expect(await db.select().from(repos)).toHaveLength(1);
	expect(
		(await db.select().from(organizationInstallations))[0]?.organizationId,
	).toBe(job.orgId);
	expect(
		await orgServices.getOrgRepo(db, {
			orgId: job.orgId,
			repoName: repository.name,
		}),
	).not.toBeNull();
});

test("GitHub rows with the same external identity and name remain isolated", async () => {
	await repoServices.ensureRepo(db, {
		forge: "github",
		externalId: repository.id,
		owner: repository.owner,
		name: repository.name,
		fullName: `${repository.owner}/${repository.name}`,
	});
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	expect(
		(await db.select().from(repos)).map((row) => row.forge).sort(),
	).toEqual(["gitcafe", "github"]);
});

for (const forge of ["github", "opengit", "gitcafe"] as const) {
	test(`same-org ${forge} name collision refuses without a claim or repository mutation`, async () => {
		const id = await repoServices.ensureRepo(db, {
			forge,
			externalId: generateId(),
			owner: "other-owner",
			name: repository.name,
			fullName: `other-owner/${repository.name}`,
			orgId: job.orgId,
		});
		await db.update(repos).set({ armed: true }).where(eq(repos.id, id));
		const before = await db.select().from(repos);
		expect(
			(
				await orgServices.getOrgRepo(db, {
					orgId: job.orgId,
					repoName: repository.name,
				})
			)?.id,
		).toBe(id);
		expect(await connectGitCafeInstallation(deps, job)).toEqual({
			ok: false,
			reason: "repository-conflict",
		});
		expect(await db.select().from(organizationInstallations)).toHaveLength(0);
		expect(await db.select().from(repos)).toEqual(before);
		expect(
			(
				await orgServices.getOrgRepo(db, {
					orgId: job.orgId,
					repoName: repository.name,
				})
			)?.id,
		).toBe(id);
	});
}

for (const scenario of [
	"different-org",
	"different-name",
	"removed",
] as const) {
	test(`${scenario} GitHub row allows GitCafe connection and remains untouched`, async () => {
		const otherOrgId = generateId();
		if (scenario === "different-org")
			await db.insert(organization).values({
				id: otherOrgId,
				name: "Other tenant",
				slug: `other-${otherOrgId}`,
			});
		const id = await repoServices.ensureRepo(db, {
			forge: "github",
			externalId: generateId(),
			owner: repository.owner,
			name: scenario === "different-name" ? "another-repo" : repository.name,
			fullName: `${repository.owner}/${scenario === "different-name" ? "another-repo" : repository.name}`,
			orgId: scenario === "different-org" ? otherOrgId : job.orgId,
		});
		if (scenario === "removed")
			await db
				.update(repos)
				.set({ removedAt: new Date() })
				.where(eq(repos.id, id));
		const before = await db.select().from(repos).where(eq(repos.id, id));
		expect(await connectGitCafeInstallation(deps, job)).toEqual({
			ok: true,
			repoCount: 1,
		});
		expect(await db.select().from(repos).where(eq(repos.id, id))).toEqual(
			before,
		);
		expect(
			(
				await orgServices.getOrgRepo(db, {
					orgId: job.orgId,
					repoName: repository.name,
				})
			)?.forge,
		).toBe("gitcafe");
		if (scenario !== "removed")
			expect(
				(
					await orgServices.getOrgRepo(db, {
						orgId: scenario === "different-org" ? otherOrgId : job.orgId,
						repoName:
							scenario === "different-name" ? "another-repo" : repository.name,
					})
				)?.id,
			).toBe(id);
	});
}

test("queued repository-conflict output reaches setup status without a claim", async () => {
	await repoServices.ensureRepo(db, {
		forge: "github",
		externalId: generateId(),
		owner: repository.owner,
		name: repository.name,
		fullName: `${repository.owner}/${repository.name}`,
		orgId: job.orgId,
	});
	const queued = await gitCafeConnectionServices.enqueueGitCafeConnection(
		db,
		boss,
		job,
	);
	if (!queued.ok) throw new Error("enqueue refused");
	const result = await connectGitCafeInstallation(deps, job);
	expect(result).toEqual({ ok: false, reason: "repository-conflict" });
	await boss.complete(GITCAFE_CONNECT_QUEUE, queued.jobId, result, {
		includeQueued: true,
	});
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(db, boss, {
			userId: job.userId,
			sessionId: job.sessionId,
			orgId: job.orgId,
			installationId: job.installationId,
			jobId: queued.jobId,
		}),
	).toEqual({ status: "refused", reason: "repository-conflict" });
	expect(await db.select().from(organizationInstallations)).toHaveLength(0);
});

test("a conflicting reconnect preserves the existing claim and all repository state", async () => {
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	await repoServices.ensureRepo(db, {
		forge: "github",
		externalId: generateId(),
		owner: "another-owner",
		name: "collision",
		fullName: "another-owner/collision",
		orgId: job.orgId,
	});
	const beforeRepos = await db.select().from(repos).orderBy(repos.id);
	const beforeClaims = await db.select().from(organizationInstallations);
	expect(
		await gitCafeConnectionServices.commitGitCafeConnection(db, {
			job,
			owner: repository.owner,
			repositories: [
				{ ...repository, id: generateId(), name: "available" },
				{ ...repository, id: generateId(), name: "collision" },
			],
			revalidate: async () => ({ ok: true, repoCount: 2 }),
		}),
	).toEqual({ ok: false, reason: "repository-conflict" });
	expect(await db.select().from(repos).orderBy(repos.id)).toEqual(beforeRepos);
	expect(await db.select().from(organizationInstallations)).toEqual(
		beforeClaims,
	);
});

test("two selected GitCafe repositories with the same name refuse before any writes", async () => {
	expect(
		await gitCafeConnectionServices.commitGitCafeConnection(db, {
			job,
			owner: repository.owner,
			repositories: [repository, { ...repository, id: generateId() }],
			revalidate: async () => ({ ok: true, repoCount: 2 }),
		}),
	).toEqual({ ok: false, reason: "repository-mismatch" });
	expect(await db.select().from(repos)).toHaveLength(0);
	expect(await db.select().from(organizationInstallations)).toHaveLength(0);
});

test("concurrent GitCafe installations cannot introduce the same org repository name", async () => {
	const results = await Promise.all(
		[repository.owner, "another-owner"].map((owner) =>
			gitCafeConnectionServices.commitGitCafeConnection(db, {
				job: { ...job, installationId: `installation-${owner}` },
				owner,
				repositories: [{ ...repository, owner, id: generateId() }],
				revalidate: async () => ({ ok: true, repoCount: 1 }),
			}),
		),
	);
	expect(results.filter((result) => result.ok)).toHaveLength(1);
	expect(results.filter((result) => !result.ok)).toEqual([
		{ ok: false, reason: "repository-conflict" },
	]);
	expect(await db.select().from(repos)).toHaveLength(1);
	expect(await db.select().from(organizationInstallations)).toHaveLength(1);
});

for (const mutation of ["insert", "rename", "move", "revive"] as const) {
	test(`concurrent GitHub ${mutation} is visible before the atomic GitCafe name check`, async () => {
		const id = generateId();
		const values = {
			id,
			forge: "github" as const,
			externalId: generateId(),
			owner: "another-owner",
			name: repository.name,
			fullName: `another-owner/${repository.name}`,
			orgId: job.orgId,
		};
		if (mutation !== "insert")
			await db.insert(repos).values({
				...values,
				name: mutation === "rename" ? "old-name" : repository.name,
				orgId: mutation === "move" ? null : job.orgId,
				removedAt: mutation === "revive" ? new Date() : null,
			});
		let release = () => {};
		let ready = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		const written = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const writer = db.transaction(async (tx) => {
			if (mutation === "insert") await tx.insert(repos).values(values);
			else
				await tx
					.update(repos)
					.set({ name: repository.name, orgId: job.orgId, removedAt: null })
					.where(eq(repos.id, id));
			ready();
			await released;
		});
		let connection: ReturnType<typeof connectGitCafeInstallation> | undefined;
		try {
			await written;
			connection = connectGitCafeInstallation(deps, job);
			let waiting = false;
			for (let attempt = 0; attempt < 100; attempt++) {
				const result = await pool.query<{ waiting: boolean }>(
					"SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation = 'repos'::regclass AND mode = 'ShareRowExclusiveLock' AND NOT granted) AS waiting",
				);
				waiting = result.rows[0]?.waiting === true;
				if (waiting) break;
				await sleep(10);
			}
			expect(waiting).toBe(true);
		} finally {
			release();
			await writer;
			await connection;
		}
		expect(await connection).toEqual({
			ok: false,
			reason: "repository-conflict",
		});
		expect(await db.select().from(organizationInstallations)).toHaveLength(0);
		expect((await db.select().from(repos)).map((row) => row.id)).toEqual([id]);
		expect(
			(
				await orgServices.getOrgRepo(db, {
					orgId: job.orgId,
					repoName: repository.name,
				})
			)?.id,
		).toBe(id);
	});
}

test("stale and future jobs, unexpected secrets and client actor extensions are rejected before provider reads", async () => {
	for (const input of [
		{ ...job, expiresAt: Date.now() - 1, authorizedAt: Date.now() - 60_000 },
		{ ...job, authorizedAt: Date.now() + 10_000 },
		{ ...job, accessToken: "secret" },
	])
		expect((await connectGitCafeInstallation(deps, input)).ok).toBe(false);
	expect(reads).toBe(0);
});

test("revoked, impersonated, expired, unapproved or banned sessions fail before provider reads", async () => {
	await db
		.update(session)
		.set({ impersonatedBy: generateId() })
		.where(eq(session.id, job.sessionId));
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "unauthorized",
	});
	await db
		.update(session)
		.set({ impersonatedBy: null, expiresAt: new Date(0) })
		.where(eq(session.id, job.sessionId));
	expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	await db
		.update(session)
		.set({ expiresAt: new Date(Date.now() + 60_000) })
		.where(eq(session.id, job.sessionId));
	for (const update of [
		{ accessStatus: "pending" as const },
		{ accessStatus: "approved" as const, banned: true },
	]) {
		await db.update(user).set(update).where(eq(user.id, job.userId));
		expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	}
	await db.delete(session).where(eq(session.id, job.sessionId));
	expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	expect(reads).toBe(0);
});

test("current custom connections:manage permission authorizes, and removal before atomic commit refuses", async () => {
	await db
		.update(member)
		.set({ role: "connection-manager" })
		.where(eq(member.userId, job.userId));
	await db.insert(organizationRole).values({
		id: generateId(),
		organizationId: job.orgId,
		role: "connection-manager",
		permission: JSON.stringify({ connections: ["manage"] }),
	});
	beforeFetch = async () => {
		if (reads === 2) await db.delete(organizationRole);
	};
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "unauthorized",
	});
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("current custom connections:manage permission allows a person with no local provider account", async () => {
	await db
		.update(member)
		.set({ role: "connection-manager" })
		.where(eq(member.userId, job.userId));
	await db.insert(organizationRole).values({
		id: generateId(),
		organizationId: job.orgId,
		role: "connection-manager",
		permission: JSON.stringify({ connections: ["manage"] }),
	});
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
});

test("actor authority is fresh at mutation and incomplete member pages fail closed", async () => {
	beforeFetch = async () => {
		if (reads === 3) membersResponse = { ...membership, items: [] };
	};
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "not-admin",
	});
	expect(await db.select().from(organizationInstallations)).toHaveLength(0);
	beforeFetch = async () => {};
	membersResponse = { ...membership, next: "next-page" };
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "authority-unavailable",
	});
});

for (const scenario of [
	{
		name: "revoked",
		members: { ...membership, items: [] },
		reason: "not-admin" as const,
	},
	{
		name: "demoted",
		members: {
			...membership,
			items: membership.items.map((entry) => ({
				...entry,
				role: "org-member",
			})),
		},
		reason: "not-admin" as const,
	},
	{
		name: "ambiguous",
		members: {
			...membership,
			items: [...membership.items, ...membership.items],
		},
		reason: "not-admin" as const,
	},
	{
		name: "incomplete",
		members: { ...membership, next: "next-page" },
		reason: "authority-unavailable" as const,
	},
]) {
	test(`membership ${scenario.name} during the final repository read refuses without persisting ownership`, async () => {
		let repositoryReads = 0;
		const readRepository = deps.client.getRepositories;
		deps.client.getRepositories = async (...args) => {
			repositoryReads++;
			if (repositoryReads === 2) membersResponse = scenario.members;
			return readRepository(...args);
		};
		expect(await connectGitCafeInstallation(deps, job)).toEqual({
			ok: false,
			reason: scenario.reason,
		});
		expect(repositoryReads).toBe(2);
		expect(reads).toBe(6);
		expect(await db.select().from(organizationInstallations)).toHaveLength(0);
		expect(await db.select().from(repos)).toHaveLength(0);
	});
}

test("a stopped queue returns queue-unavailable instead of rejecting after authorization", async () => {
	const unavailable = await createBoss(container.url);
	await unavailable.stop({ graceful: false });
	expect(
		await gitCafeConnectionServices.enqueueGitCafeConnection(
			db,
			unavailable,
			job,
		),
	).toEqual({ ok: false, reason: "queue-unavailable" });
	expect(await db.select().from(organizationInstallations)).toHaveLength(0);
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("a queue outage during send returns queue-unavailable", async () => {
	const unavailable = await createBoss(container.url);
	const createQueue = unavailable.createQueue.bind(unavailable);
	const create = spyOn(unavailable, "createQueue").mockImplementation(
		async (...args) => {
			await createQueue(...args);
			await unavailable.stop({ graceful: false });
		},
	);
	try {
		expect(
			await gitCafeConnectionServices.enqueueGitCafeConnection(
				db,
				unavailable,
				job,
			),
		).toEqual({ ok: false, reason: "queue-unavailable" });
		expect(await db.select().from(organizationInstallations)).toHaveLength(0);
		expect(await db.select().from(repos)).toHaveLength(0);
	} finally {
		create.mockRestore();
		await unavailable.stop({ graceful: false });
	}
});

test("inactive, wrong-app and unstable installation evidence fail closed", async () => {
	for (const change of [
		{ pausedAt: new Date().toISOString() },
		{ appId: "wrong-app" },
		{ repositories: [repository.name, repository.name] },
	]) {
		changedLookup = () => ({ ...installation, ...change });
		expect((await connectGitCafeInstallation(deps, job)).ok).toBe(false);
	}
	changedLookup = () => ({
		...installation,
		revision: installation.revision + lookupCount,
	});
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: false,
		reason: "installation-mismatch",
	});
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("wrong owner, selected name, missing stable id, and disappearing repository are refused", async () => {
	for (const response of [
		{ ...repository, owner: "other" },
		{ ...repository, name: "other" },
		{ ...repository, archivedAt: new Date().toISOString() },
		{ ...repository, id: undefined },
		null,
	]) {
		repositoryResponse = response;
		expect(await connectGitCafeInstallation(deps, job)).toEqual({
			ok: false,
			reason: "repository-mismatch",
		});
	}
	expect(await db.select().from(repos)).toHaveLength(0);
});

test("generic claims cannot bypass GitCafe fresh authority and protection remains off", async () => {
	expect(
		await orgServices.linkOrgInstallation(db, {
			forge: "gitcafe",
			orgId: job.orgId,
			installationId: job.installationId,
		}),
	).toEqual({ claimed: false });
	expect(
		await orgServices.moveInstallation(db, {
			forge: "gitcafe",
			toOrgId: job.orgId,
			installationId: job.installationId,
		}),
	).toEqual({ moved: false });
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	const [row] = await db.select().from(repos);
	if (!row) throw new Error("missing connected row");
	const refused: RepoArmingResult = {
		ok: false,
		armed: false,
		reason: "protection-unavailable",
	};
	expect(await repoServices.setRepoArmed(db, row.id, true)).toEqual(refused);
	let queueReads = 0;
	expect(
		await repoServices.turnOnGate(
			db,
			async () => {
				queueReads++;
				return boss;
			},
			row.id,
		),
	).toEqual(refused);
	expect(queueReads).toBe(0);
	expect(await repoServices.setRepoArmed(db, row.id, false)).toEqual({
		ok: true,
		armed: false,
	});
	const workflowId = await repoServices.saveWorkflowDefinition(
		db,
		row.id,
		DEFAULT_WORKFLOW,
	);
	expect(
		await workflowServices.setWorkflowEnabled(db, {
			repoId: row.id,
			workflowId,
			enabled: true,
		}),
	).toEqual({
		ok: false,
		issues: [{ message: "Protection is unavailable for this forge" }],
	});
	expect((await repoServices.getRepoById(db, row.id))?.armed).toBe(false);
});

test("bounded status proves job metadata and current local authorization before exposing connection count", async () => {
	const queued = await gitCafeConnectionServices.enqueueGitCafeConnection(
		db,
		boss,
		job,
	);
	if (!queued.ok) throw new Error("enqueue refused");
	const request = {
		userId: job.userId,
		sessionId: job.sessionId,
		orgId: job.orgId,
		installationId: job.installationId,
		jobId: queued.jobId,
	};
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(
			db,
			boss,
			request,
		),
	).toEqual({ status: "pending" });
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(db, boss, {
			...request,
			installationId: "ins_other",
		}),
	).toEqual({ status: "retry" });
	expect(await connectGitCafeInstallation(deps, job)).toEqual({
		ok: true,
		repoCount: 1,
	});
	await boss.complete(
		GITCAFE_CONNECT_QUEUE,
		queued.jobId,
		{ ok: true, repoCount: 1 },
		{ includeQueued: true },
	);
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(
			db,
			boss,
			request,
		),
	).toEqual({ status: "connected", repoCount: 1 });
	await db
		.update(member)
		.set({ role: "member" })
		.where(eq(member.userId, job.userId));
	expect(
		await gitCafeConnectionServices.getGitCafeConnectionStatus(
			db,
			boss,
			request,
		),
	).toEqual({ status: "refused", reason: "unauthorized" });
});

test("isolated connection queue startup leaves unrelated backlog untouched", async () => {
	const backlogId = await boss.send("process-event", { eventId: generateId() });
	if (!backlogId) throw new Error("missing backlog job");
	const before = await boss.getJobById("process-event", backlogId);
	const isolated = await createGitCafeConnectionBoss(
		container.url,
		pino({ enabled: false }),
	);
	try {
		expect(await isolated.getJobById("process-event", backlogId)).toEqual(
			before,
		);
		const queued = await isolated.send(GITCAFE_CONNECT_QUEUE, job, {
			retryLimit: 0,
		});
		expect(queued).not.toBeNull();
		expect((await isolated.getJobById("process-event", backlogId))?.state).toBe(
			"created",
		);
	} finally {
		await isolated.stop({ graceful: false });
	}
});
