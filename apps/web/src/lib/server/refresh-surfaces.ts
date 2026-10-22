export async function enqueueSurfaceRefresh(repoIds: string[]): Promise<void> {
	if (repoIds.length === 0) {
		return;
	}
	const { REFRESH_SURFACES_QUEUE } = await import("@tripwire/db");
	const { getBoss } = await import("#/lib/server/db");
	try {
		const boss = await getBoss();
		await Promise.all(
			repoIds.map((repoId) =>
				boss.send(REFRESH_SURFACES_QUEUE, { repoId }, { singletonKey: repoId }),
			),
		);
	} catch (error) {
		console.error("[responses] surface refresh not enqueued:", error);
	}
}
