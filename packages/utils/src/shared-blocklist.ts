import {
	SHARED_BLOCKLIST_MAX_AGE_MS,
	SHARED_BLOCKLIST_SOURCE,
	type SharedBlocklistSnapshot,
	sharedBlocklistSnapshotSchema,
} from "@tripwire/contracts";

const REFRESH_MS = 60_000;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export function isSharedBlocklistFresh(
	snapshot: SharedBlocklistSnapshot,
	now: number,
): boolean {
	const age = now - Date.parse(snapshot.publishedAt);
	return age >= 0 && age < SHARED_BLOCKLIST_MAX_AGE_MS;
}

async function readSnapshot(): Promise<SharedBlocklistSnapshot> {
	const response = await fetch(SHARED_BLOCKLIST_SOURCE, {
		redirect: "error",
		signal: AbortSignal.timeout(3_000),
	});
	if (!response.ok || !response.body) throw new Error("Snapshot unavailable");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let json = "";
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		size += chunk.value.byteLength;
		if (size > MAX_SNAPSHOT_BYTES) {
			await reader.cancel();
			throw new Error("Snapshot exceeds size limit");
		}
		json += decoder.decode(chunk.value, { stream: true });
	}
	return sharedBlocklistSnapshotSchema.parse(
		JSON.parse(json + decoder.decode()),
	);
}

let cached: SharedBlocklistSnapshot | null = null;
let refreshAfter = 0;
let refreshing: Promise<void> | null = null;

export async function loadSharedBlocklist(
	onRefreshError?: () => void,
): Promise<SharedBlocklistSnapshot | null> {
	if (refreshing) {
		await refreshing;
	} else if (Date.now() >= refreshAfter) {
		refreshing = (async () => {
			try {
				const next = await readSnapshot();
				if (
					!isSharedBlocklistFresh(next, Date.now()) ||
					(cached && next.revision < cached.revision)
				) {
					throw new Error(
						"Snapshot is stale or older than the last accepted revision",
					);
				}
				cached = next;
			} catch {
				onRefreshError?.();
			} finally {
				refreshAfter = Date.now() + REFRESH_MS;
				refreshing = null;
			}
		})();
		await refreshing;
	}
	return cached && isSharedBlocklistFresh(cached, Date.now()) ? cached : null;
}

export async function loadPublishedSharedBlocklist(): Promise<SharedBlocklistSnapshot | null> {
	const snapshot = await loadSharedBlocklist();
	if (!snapshot) return null;
	const now = Date.now();
	return {
		...snapshot,
		entries: snapshot.entries.filter(
			(entry) => Date.parse(entry.expiresAt) > now,
		),
	};
}
