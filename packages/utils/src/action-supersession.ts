const PER_CHANGE_REQUEST_KINDS = new Set([
	"comment",
	"delete-comment",
	"dismiss-review",
	"block",
	"close",
	"request-fix",
	"note",
]);

export function supersededBy(
	kind: string,
	run: { id: string; headSha: string | null },
	latest: { id: string; headSha: string | null } | null,
): boolean {
	if (!latest || latest.id === run.id) return false;
	if (PER_CHANGE_REQUEST_KINDS.has(kind)) return true;
	return kind === "set-check" && run.headSha !== null
		? latest.headSha === run.headSha
		: false;
}

export function pendingCheckIsStale(
	latest: { eventId: string; headSha: string | null } | null,
	eventId: string,
	headSha: string,
): boolean {
	return (
		latest !== null && latest.eventId > eventId && latest.headSha === headSha
	);
}
