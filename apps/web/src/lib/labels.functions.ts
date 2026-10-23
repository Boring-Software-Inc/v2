import { createServerFn } from "@tanstack/react-start";
import type { RepoLabel } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export interface RepoLabelsView {
	labels: RepoLabel[];
	syncedAt: string | null;
	syncing: boolean;
}

async function queueLabelSync(repoId: string): Promise<boolean> {
	const { getBoss, isDemoMode } = await import("#/lib/server/db");
	if (isDemoMode()) {
		return false;
	}
	const { SYNC_REPO_LABELS_QUEUE, syncRepoLabelsOptions } = await import(
		"@tripwire/db"
	);
	const boss = await getBoss();
	await boss.send(
		SYNC_REPO_LABELS_QUEUE,
		{ repoId },
		syncRepoLabelsOptions(repoId),
	);
	return true;
}

export const listRepoLabels = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:read"),
	])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RepoLabelsView> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { labelServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const list = await labelServices.listRepoLabels(getDb().db, data.repoId);
		const syncing = labelServices.labelsNeedSync(list.syncedAt, new Date())
			? await queueLabelSync(data.repoId)
			: false;
		return {
			labels: list.labels,
			syncedAt: list.syncedAt?.toISOString() ?? null,
			syncing,
		};
	});

export const refreshRepoLabels = createServerFn({ method: "POST" })
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
		return { queued: await queueLabelSync(data.repoId) };
	});
