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
	eventKind: string | null;
	title: string | null;
	reason: string | null;
}

export interface ModerationQueue {
	items: ModerationQueueItem[];
	limit: number;
	truncated: boolean;
}

export const listModerationQueue = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<ModerationQueue> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { moderationServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const limit = moderationServices.PENDING_ITEMS_LIMIT;
		const rows = await moderationServices.listPendingItems(
			getDb().db,
			repo.fullName,
			limit + 1,
		);
		const items = rows.slice(0, limit).map((item) => ({
			id: item.id,
			runId: item.runId,
			nodeId: item.nodeId,
			repoFullName: item.repoFullName,
			subjectNumber: item.subjectNumber,
			actorLogin: item.actorLogin,
			createdAt: item.createdAt.toISOString(),
			eventKind: item.eventKind,
			title: item.title,
			reason: item.reason,
		}));
		return { items, limit, truncated: rows.length > limit };
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
		const { moderationServices } = await import("@tripwire/db");
		const { getDb, getBoss, isDemoMode } = await import("#/lib/server/db");
		const result = await moderationServices.decideRepoModerationItem(
			getDb().db,
			isDemoMode() ? null : { pool: getDb().pool, boss: await getBoss() },
			{
				repoFullName: repo.fullName,
				itemId: data.itemId,
				decision: data.decision,
				decidedBy,
			},
		);
		if (result === "not-found") {
			throw notFound();
		}
		return result;
	});
