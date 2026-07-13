import { createServerFn } from "@tanstack/react-start";

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

export const listModerationQueue = createServerFn({ method: "GET" }).handler(
	async (): Promise<ModerationQueueItem[]> => {
		const { getActiveRepo } = await import("#/lib/server/active-repo");
		const repo = await getActiveRepo();
		if (!repo) {
			return [];
		}
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
	},
);

export const decideModeration = createServerFn({ method: "POST" })
	.inputValidator(
		(input: { itemId: string; decision: "approve" | "deny" }) => input,
	)
	.handler(async ({ data }): Promise<{ ok: boolean }> => {
		const { requireSession } = await import("#/lib/server/session");
		const decidedBy = await requireSession();
		const { moderationServices } = await import("@tripwire/db");
		const { getDb, getBoss, isDemoMode } = await import("#/lib/server/db");
		// dev:demo has no worker to resume the run — record the decision so the
		// queue updates; a real head enqueues a resume job in one transaction.
		if (isDemoMode()) {
			const ok = await moderationServices.markModerationDecided(getDb().db, {
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
