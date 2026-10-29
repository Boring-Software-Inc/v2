import { createServerFn } from "@tanstack/react-start";
import {
	type RepoReviewersView,
	repoReviewersInputSchema,
	repoReviewersViewSchema,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

async function queueReviewerSync(repoId: string): Promise<boolean> {
	const { getBoss, getDb, isDemoMode, queueGitCafeCatalogRefresh } =
		await import("#/lib/server/db");
	if (isDemoMode()) {
		return false;
	}
	const { repoServices, SYNC_REPO_REVIEWERS_QUEUE, syncRepoReviewersOptions } =
		await import("@tripwire/db");
	const repo = await repoServices.getRepoById(getDb().db, repoId);
	if (repo?.forge === "gitcafe") return queueGitCafeCatalogRefresh(repoId);
	const boss = await getBoss();
	await boss.send(
		SYNC_REPO_REVIEWERS_QUEUE,
		{ repoId },
		syncRepoReviewersOptions(repoId),
	);
	return true;
}

export const listRepoReviewers = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:read"),
	])
	.inputValidator(repoReviewersInputSchema)
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
		const syncing = reviewerServices.reviewersNeedSync(
			list.syncedAt,
			new Date(),
		)
			? await queueReviewerSync(data.repoId)
			: false;
		return repoReviewersViewSchema.parse({
			reviewers: list.reviewers,
			syncedAt: list.syncedAt?.toISOString() ?? null,
			syncing,
		});
	});

export const refreshRepoReviewers = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:manage"),
	])
	.inputValidator(repoReviewersInputSchema)
	.handler(async ({ data, context }): Promise<{ queued: boolean }> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		return { queued: await queueReviewerSync(data.repoId) };
	});
