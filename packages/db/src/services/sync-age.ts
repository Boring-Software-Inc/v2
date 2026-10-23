export function syncIsStale(
	syncedAt: Date | null,
	now: Date,
	maxAgeMs: number,
): boolean {
	return syncedAt === null || now.getTime() - syncedAt.getTime() >= maxAgeMs;
}
