import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

export interface ModerationQueueItem {
	id: string;
	runId: string;
	/** Workflow node that paused the run; "run:degraded" for the fail-closed floor. */
	nodeId: string;
	repoFullName: string;
	subjectNumber: number | null;
	actorLogin: string | null;
	createdAt: string;
}

export const listModerationQueue = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<ModerationQueueItem[]> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { moderationServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const items = await moderationServices.listPendingItems(
			getDb().db,
			repo.fullName,
		);
		return items.map((item) => ({
			id: item.id,
			runId: item.runId,
			nodeId: item.nodeId,
			repoFullName: item.repoFullName,
			subjectNumber: item.subjectNumber,
			actorLogin: item.actorLogin,
			createdAt: item.createdAt.toISOString(),
		}));
	});

/**
 * Admin-only (§4 decision): approving a paused run releases code through the
 * gate — a trust-level action, not triage. First candidate for a per-org
 * setting / third role when a customer needs member-level triage; loosening
 * is this one site (orgAdminMiddleware → orgMemberMiddleware + the
 * classification row).
 */
export const decideModeration = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repo: string;
			itemId: string;
			decision: "approve" | "deny";
		}) => input,
	)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { requireSession } = await import("#/lib/server/session");
		const decidedBy = await requireSession();
		const { moderationServices, schema } = await import("@tripwire/db");
		const { getDb, getBoss, isDemoMode } = await import("#/lib/server/db");
		const { and, eq } = await import("drizzle-orm");
		const db = getDb().db;
		// Authz: the item must belong to THIS org's repo — an admin of org A
		// must not be able to decide org B's item by id. Same 404 shape as the
		// resolvers: foreign items are indistinguishable from missing ones.
		const owned = await db
			.select({ id: schema.moderationItems.id })
			.from(schema.moderationItems)
			.innerJoin(schema.runs, eq(schema.runs.id, schema.moderationItems.runId))
			.where(
				and(
					eq(schema.moderationItems.id, data.itemId),
					eq(schema.runs.repoFullName, repo.fullName),
				),
			)
			.limit(1);
		if (!owned[0]) {
			throw notFound();
		}
		// dev:demo has no worker to resume the run — record the decision so the
		// queue updates; a real head enqueues a resume job in one transaction.
		if (isDemoMode()) {
			const ok = await moderationServices.markModerationDecided(db, {
				itemId: data.itemId,
				decision: data.decision,
				decidedBy,
			});
			return { ok };
		}
		const ok = await moderationServices.decideModerationItem(
			getDb().pool,
			await getBoss(),
			{ itemId: data.itemId, decision: data.decision, decidedBy },
		);
		return { ok };
	});
