import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	contributionAppealOrgSchema,
	contributionAppealRunSchema,
	decideContributionAppealSchema,
	listContributionAppealsSchema,
	resolveOrganizationAppealSchema,
	submitContributionAppealSchema,
	submitOrganizationAppealSchema,
} from "@tripwire/contracts";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	type OrgContext,
	orgPermissionMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";
import { sameOriginMiddleware } from "#/lib/server/staff-guard";

async function readAppealSession() {
	const { setResponseHeader } = await import("@tanstack/react-start/server");
	setResponseHeader("Cache-Control", "private, no-store");
	const { getAuth } = await import("#/lib/server/auth");
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const { fenceOf } = await import("#/lib/server/staff-users");
	const session = await getAuth()?.api.getSession({
		headers: getStartContext().request.headers,
	});
	if (!session) return null;
	const fence = await fenceOf(session);
	return fence.live && !fence.banned && !fence.impersonatedBy
		? session.user.id
		: null;
}

export const getContributionAppeal = createServerFn({ method: "GET" })
	.inputValidator(contributionAppealRunSchema)
	.handler(async ({ data }) => {
		const userId = await readAppealSession();
		if (!userId) return { state: "signed-out" } as const;
		const { contributionAppealServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const appeal = await contributionAppealServices.getOwnAppeal(
			getDb().db,
			data.runId,
			userId,
		);
		return appeal
			? ({ state: "eligible", ...appeal } as const)
			: ({ state: "unavailable" } as const);
	});

export const getContributionAppealPortal = createServerFn({ method: "GET" })
	.inputValidator(contributionAppealOrgSchema)
	.handler(async ({ data }) => {
		const userId = await readAppealSession();
		if (!userId) return { state: "signed-out" } as const;
		const { contributionAppealServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return {
			state: "signed-in",
			...(await contributionAppealServices.listOwnAppealCases(
				getDb().db,
				data.org,
				userId,
			)),
		} as const;
	});

export const submitContributionAppeal = createServerFn({ method: "POST" })
	.middleware([sameOriginMiddleware])
	.inputValidator(submitContributionAppealSchema)
	.handler(async ({ data }) => {
		const userId = await readAppealSession();
		if (!userId) return null;
		const { contributionAppealServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return contributionAppealServices.submitAppeal(getDb().db, {
			...data,
			userId,
		});
	});

export const submitOrganizationAppeal = createServerFn({ method: "POST" })
	.middleware([sameOriginMiddleware])
	.inputValidator(submitOrganizationAppealSchema)
	.handler(async ({ data }) => {
		const userId = await readAppealSession();
		if (!userId) return { status: "unavailable" } as const;
		const { contributionAppealServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return contributionAppealServices.submitOrganizationAppeal(getDb().db, {
			...data,
			userId,
		});
	});

export const resolveOrganizationAppeal = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("moderation:manage"),
		sameOriginMiddleware,
	])
	.inputValidator(resolveOrganizationAppealSchema)
	.handler(async ({ data, context }) => {
		const { org } = context as OrgContext;
		const userId = await readAppealSession();
		if (!userId) throw notFound();
		const { contributionAppealServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return contributionAppealServices.resolveOrganizationAppeal(getDb().db, {
			orgId: org.id,
			appealId: data.appealId,
			userId,
		});
	});

export const listContributionAppeals = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("moderation:read"),
	])
	.inputValidator(listContributionAppealsSchema)
	.handler(async ({ data, context }) => {
		const { org } = context as OrgContext;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { contributionAppealServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const { db } = getDb();
		const [rows, organizationAppeals] = await Promise.all([
			contributionAppealServices.listPendingAppeals(db, repo.id),
			contributionAppealServices.listPendingOrganizationAppeals(db, org.id),
		]);
		return {
			contributions: rows.map(
				({ id, runId, subjectKind, subjectNumber, login, reason }) => ({
					id,
					runId,
					subjectKind,
					subjectNumber,
					login,
					reason,
				}),
			),
			organizationAppeals,
		};
	});

export const decideContributionAppeal = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("moderation:manage"),
		sameOriginMiddleware,
	])
	.inputValidator(decideContributionAppealSchema)
	.handler(async ({ data, context }) => {
		const { org } = context as OrgContext;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const userId = await readAppealSession();
		if (
			!userId ||
			(data.decision === "approve-author" &&
				!org.permissions.includes("rules:manage"))
		) {
			throw notFound();
		}
		const { contributionAppealServices, moderationPolicyServices } =
			await import("@tripwire/db");
		const { getDb, getBoss, isDemoMode } = await import("#/lib/server/db");
		const { db, pool } = getDb();
		const queue =
			data.decision === "deny" || isDemoMode()
				? undefined
				: { pool, boss: await getBoss() };
		return contributionAppealServices.decideAppeal(
			db,
			{
				repoId: repo.id,
				appealId: data.appealId,
				decidedBy: userId,
				decision: data.decision,
			},
			async (tx, appeal, decision) => {
				if (decision === "approve-author") {
					await moderationPolicyServices.addAllowlistEntry(tx, repo.id, {
						accountId: appeal.accountId,
						login: appeal.login,
					});
				}
			},
			queue,
		);
	});
