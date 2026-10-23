import { createServerFn } from "@tanstack/react-start";
import type { RepoReviewer } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export interface RepoReviewersView {
	reviewers: RepoReviewer[];
	syncedAt: string | null;
}

export const listRepoReviewers = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:read"),
	])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RepoReviewersView> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { reviewerServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const list = await reviewerServices.listRepoReviewers(
			getDb().db,
			data.repoId,
		);
		return {
			reviewers: list.reviewers,
			syncedAt: list.syncedAt?.toISOString() ?? null,
		};
	});

export const refreshRepoReviewers = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:manage"),
	])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<{ queued: boolean }> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { getBoss, isDemoMode } = await import("#/lib/server/db");
		if (isDemoMode()) {
			return { queued: false };
		}
		const { SYNC_REPO_REVIEWERS_QUEUE, syncRepoReviewersOptions } =
			await import("@tripwire/db");
		const boss = await getBoss();
		await boss.send(
			SYNC_REPO_REVIEWERS_QUEUE,
			{ repoId: data.repoId },
			syncRepoReviewersOptions(data.repoId),
		);
		return { queued: true };
	});
