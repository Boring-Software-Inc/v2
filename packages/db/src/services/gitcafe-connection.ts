import {
	GITCAFE_CONNECT_QUEUE,
	type GitCafeConnectionJob,
	type GitCafeConnectionRefusal,
	type GitCafeConnectionRepository,
	type GitCafeConnectionResult,
	type GitCafeConnectionStatus,
	type GitCafeConnectionStatusRequest,
	gitCafeConnectionJobSchema,
	gitCafeConnectionRepositoriesSchema,
	gitCafeConnectionResultSchema,
	gitCafeConnectionStatusRequestSchema,
	orgRoleStatementsSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Db } from "../client.ts";
import { session, user } from "../schema/auth.ts";
import {
	member,
	organizationInstallations,
	organizationRole,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import type { DbLike } from "./access.ts";

/** Re-read the session and role at use time; the queue is not a durable membership grant. */
export async function canManageGitCafeConnection(
	db: DbLike,
	input: Pick<GitCafeConnectionJob, "userId" | "sessionId" | "orgId">,
	lock = false,
): Promise<boolean> {
	const query = db
		.select({ role: member.role })
		.from(session)
		.innerJoin(user, eq(user.id, session.userId))
		.innerJoin(
			member,
			and(eq(member.userId, user.id), eq(member.organizationId, input.orgId)),
		)
		.where(
			and(
				eq(session.id, input.sessionId),
				eq(session.userId, input.userId),
				gt(session.expiresAt, new Date()),
				isNull(session.impersonatedBy),
				eq(user.banned, false),
				eq(user.accessStatus, "approved"),
			),
		)
		.limit(1);
	const [row] = await (lock
		? query.for("share", { of: [session, user, member] })
		: query);
	if (!row) return false;
	const names = row.role
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	if (names.includes("admin")) return true;
	const customQuery = db
		.select({ permission: organizationRole.permission })
		.from(organizationRole)
		.where(
			and(
				eq(organizationRole.organizationId, input.orgId),
				inArray(
					organizationRole.role,
					names.filter((name) => name !== "member"),
				),
			),
		);
	const custom = await (lock ? customQuery.for("share") : customQuery);
	return custom.some((role) => {
		try {
			const parsed = orgRoleStatementsSchema.safeParse(
				JSON.parse(role.permission),
			);
			return (
				parsed.success && parsed.data.connections?.includes("manage") === true
			);
		} catch {
			return false;
		}
	});
}

export async function enqueueGitCafeConnection(
	db: Db,
	boss: PgBoss | null,
	input: GitCafeConnectionJob,
): Promise<
	{ ok: true; jobId: string } | { ok: false; reason: GitCafeConnectionRefusal }
> {
	const parsed = gitCafeConnectionJobSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid-job" };
	const job = parsed.data;
	if (job.authorizedAt > Date.now() || job.expiresAt <= Date.now())
		return { ok: false, reason: "expired" };
	if (!(await canManageGitCafeConnection(db, job)))
		return { ok: false, reason: "unauthorized" };
	if (!boss) return { ok: false, reason: "queue-unavailable" };
	await boss.createQueue(GITCAFE_CONNECT_QUEUE);
	const jobId = await boss.send(GITCAFE_CONNECT_QUEUE, job, {
		retryLimit: 0,
		expireInSeconds: 300,
		retentionSeconds: 600,
	});
	return jobId
		? { ok: true, jobId }
		: { ok: false, reason: "queue-unavailable" };
}

/** Serialize ownership checks and their writes so concurrent claims cannot partially transfer repositories. */
export async function commitGitCafeConnection(
	db: Db,
	input: {
		job: GitCafeConnectionJob;
		owner: string;
		repositories: GitCafeConnectionRepository[];
		revalidate: () => Promise<GitCafeConnectionResult>;
	},
): Promise<GitCafeConnectionResult> {
	const job = gitCafeConnectionJobSchema.safeParse(input.job);
	const selected = gitCafeConnectionRepositoriesSchema.safeParse(
		input.repositories,
	);
	if (!job.success || !selected.success || selected.data.length === 0)
		return { ok: false, reason: "invalid-job" };
	const repositoryRows = selected.data;
	if (
		repositoryRows.some(
			(repo) => repo.owner !== input.owner || repo.archivedAt !== null,
		) ||
		new Set(repositoryRows.map((repo) => repo.id)).size !==
			repositoryRows.length ||
		new Set(repositoryRows.map((repo) => repo.name)).size !==
			repositoryRows.length
	)
		return { ok: false, reason: "repository-mismatch" };
	return await db.transaction(async (tx): Promise<GitCafeConnectionResult> => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		if (!(await canManageGitCafeConnection(tx, job.data, true)))
			return { ok: false, reason: "unauthorized" };
		const [claim] = await tx
			.select()
			.from(organizationInstallations)
			.where(
				and(
					eq(organizationInstallations.forge, "gitcafe"),
					eq(organizationInstallations.installationId, job.data.installationId),
				),
			)
			.for("update");
		if (
			claim &&
			(claim.organizationId !== job.data.orgId ||
				claim.accountLogin !== input.owner)
		)
			return { ok: false, reason: "ownership-conflict" };
		const existing = await tx
			.select()
			.from(repos)
			.where(
				and(
					eq(repos.forge, "gitcafe"),
					or(
						inArray(
							repos.externalId,
							repositoryRows.map((repo) => repo.id),
						),
						inArray(
							repos.fullName,
							repositoryRows.map((repo) => `${repo.owner}/${repo.name}`),
						),
						eq(repos.installationId, job.data.installationId),
					),
				),
			)
			.for("update");
		for (const repo of existing) {
			const selectedRepo = repositoryRows.find(
				(selectedRepo) => selectedRepo.id === repo.externalId,
			);
			if (
				(repo.orgId !== null && repo.orgId !== job.data.orgId) ||
				(repo.installationId !== null &&
					repo.installationId !== job.data.installationId) ||
				(selectedRepo === undefined &&
					repositoryRows.some(
						(selectedRepo) =>
							`${selectedRepo.owner}/${selectedRepo.name}` === repo.fullName,
					))
			)
				return { ok: false, reason: "ownership-conflict" };
		}
		const current = await input.revalidate();
		if (!current.ok) return current;
		if (job.data.authorizedAt > Date.now() || job.data.expiresAt <= Date.now())
			return { ok: false, reason: "expired" };
		if (!(await canManageGitCafeConnection(tx, job.data, true)))
			return { ok: false, reason: "unauthorized" };
		await tx
			.insert(organizationInstallations)
			.values({
				id: generateId(),
				organizationId: job.data.orgId,
				forge: "gitcafe",
				installationId: job.data.installationId,
				accountType: "Organization",
				accountLogin: input.owner,
			})
			.onConflictDoNothing();
		for (const repo of repositoryRows) {
			await tx
				.insert(repos)
				.values({
					id: generateId(),
					forge: "gitcafe",
					externalId: repo.id,
					owner: repo.owner,
					name: repo.name,
					fullName: `${repo.owner}/${repo.name}`,
					private: repo.visibility === "private",
					installationId: job.data.installationId,
					orgId: job.data.orgId,
					armed: false,
				})
				.onConflictDoUpdate({
					target: [repos.forge, repos.externalId],
					set: {
						owner: repo.owner,
						name: repo.name,
						fullName: `${repo.owner}/${repo.name}`,
						private: repo.visibility === "private",
						installationId: job.data.installationId,
						orgId: job.data.orgId,
						removedAt: null,
						armed: false,
					},
				});
		}
		for (const row of existing) {
			if (!repositoryRows.some((repo) => repo.id === row.externalId))
				await tx
					.update(repos)
					.set({ removedAt: new Date(), armed: false })
					.where(eq(repos.id, row.id));
		}
		return { ok: true, repoCount: repositoryRows.length };
	});
}

export async function getGitCafeConnectionStatus(
	db: Db,
	boss: PgBoss | null,
	input: GitCafeConnectionStatusRequest,
): Promise<GitCafeConnectionStatus> {
	const parsed = gitCafeConnectionStatusRequestSchema.safeParse(input);
	if (!parsed.success) return { status: "refused", reason: "invalid-job" };
	if (!(await canManageGitCafeConnection(db, input)))
		return { status: "refused", reason: "unauthorized" };
	if (input.jobId) {
		if (!boss) return { status: "retry" };
		const job = await boss.getJobById<GitCafeConnectionJob>(
			GITCAFE_CONNECT_QUEUE,
			input.jobId,
		);
		const bound = gitCafeConnectionJobSchema.safeParse(job?.data);
		if (
			!job ||
			!bound.success ||
			bound.data.userId !== input.userId ||
			bound.data.sessionId !== input.sessionId ||
			bound.data.orgId !== input.orgId ||
			bound.data.installationId !== input.installationId
		)
			return { status: "retry" };
		if (job.state === "completed") {
			const result = gitCafeConnectionResultSchema.safeParse(job.output);
			if (!result.success) return { status: "retry" };
			if (!result.data.ok)
				return { status: "refused", reason: result.data.reason };
		} else if (
			job.state === "failed" ||
			job.state === "cancelled" ||
			bound.data.expiresAt <= Date.now()
		)
			return { status: "retry" };
		else return { status: "pending" };
	}
	const [claim] = await db
		.select({ id: organizationInstallations.id })
		.from(organizationInstallations)
		.where(
			and(
				eq(organizationInstallations.forge, "gitcafe"),
				eq(organizationInstallations.installationId, input.installationId),
				eq(organizationInstallations.organizationId, input.orgId),
			),
		);
	if (!claim) return { status: "retry" };
	const [count] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(repos)
		.where(
			and(
				eq(repos.forge, "gitcafe"),
				eq(repos.installationId, input.installationId),
				eq(repos.orgId, input.orgId),
				isNull(repos.removedAt),
			),
		);
	return { status: "connected", repoCount: count?.n ?? 0 };
}
