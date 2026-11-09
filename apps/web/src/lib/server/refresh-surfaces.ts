import pino from "pino";

const logger = pino({ name: "surface-refresh" });

export async function enqueueSurfaceRefresh(repoIds: string[]): Promise<void> {
	if (repoIds.length === 0) {
		return;
	}
	const { REFRESH_SURFACES_QUEUE, repoServices } = await import("@tripwire/db");
	const { GITCAFE_REFRESH_SURFACES_QUEUE } = await import(
		"@tripwire/contracts"
	);
	const { getBoss, getDb, getGitCafeConnectionBoss } = await import(
		"#/lib/server/db"
	);
	try {
		await Promise.all(
			repoIds.map(async (repoId) => {
				const repo = await repoServices.getRepoById(getDb().db, repoId);
				if (!repo) return;
				const queue =
					repo.forge === "gitcafe"
						? GITCAFE_REFRESH_SURFACES_QUEUE
						: REFRESH_SURFACES_QUEUE;
				const boss =
					repo.forge === "gitcafe"
						? await getGitCafeConnectionBoss(repoId)
						: await getBoss();
				if (repo.forge === "gitcafe") await boss.createQueue(queue);
				await boss.send(queue, { repoId }, { singletonKey: repoId });
			}),
		);
	} catch {
		logger.error(
			{ reason: "queue-unavailable" },
			"Surface refresh not enqueued",
		);
	}
}
