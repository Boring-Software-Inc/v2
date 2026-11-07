import {
	SHARED_BLOCKLIST_MAX_AGE_MS,
	SHARED_BLOCKLIST_REPOSITORY,
	SHARED_BLOCKLIST_SOURCE,
	SHARED_BLOCKLIST_STAGING_SOURCE,
	type SharedBlocklistSnapshot,
	sharedBlocklistSnapshotSchema,
} from "@tripwire/contracts";

const REFRESH_MS = 60_000;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export function sharedBlocklistTarget(
	environment = process.env.UNKEY_ENVIRONMENT_SLUG,
) {
	return environment === "preview" ? "staging" : "production";
}

export function isSharedBlocklistFresh(
	snapshot: SharedBlocklistSnapshot,
	now: number,
): boolean {
	const age = now - Date.parse(snapshot.publishedAt);
	return age >= 0 && age < SHARED_BLOCKLIST_MAX_AGE_MS;
}

export function isSharedBlocklistEntryActive(
	expiresAt: string | null,
	now: number,
): boolean {
	return expiresAt === null || Date.parse(expiresAt) > now;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
	if (!response.ok || !response.body) throw new Error("Snapshot unavailable");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		size += chunk.value.byteLength;
		if (size > MAX_SNAPSHOT_BYTES) {
			await reader.cancel();
			throw new Error("Snapshot exceeds size limit");
		}
		chunks.push(chunk.value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function findPublishedCommit(body: Uint8Array, branch: string): string {
	const decoder = new TextDecoder();
	let offset = 0;
	while (offset + 4 <= body.length) {
		const length = decoder.decode(body.subarray(offset, offset + 4));
		if (!/^[0-9a-f]{4}$/.test(length)) break;
		const size = Number.parseInt(length, 16);
		if (size === 0) {
			offset += 4;
			continue;
		}
		if (size < 4 || offset + size > body.length) break;
		const packet = decoder.decode(body.subarray(offset + 4, offset + size));
		const ref = /^([0-9a-f]{40}) refs\/heads\/([^\n\0]+)(?:\0[^\n]*)?\n?$/.exec(
			packet,
		);
		if (ref?.[1] && ref[2] === branch) return ref[1];
		offset += size;
	}
	throw new Error("Published blocklist branch unavailable");
}

async function readSnapshot(): Promise<SharedBlocklistSnapshot> {
	const isStaging = sharedBlocklistTarget() === "staging";
	const branch = isStaging ? "published-staging" : "published";
	const source = isStaging
		? SHARED_BLOCKLIST_STAGING_SOURCE
		: SHARED_BLOCKLIST_SOURCE;
	const signal = AbortSignal.timeout(3_000);
	const refs = await fetch(
		`${SHARED_BLOCKLIST_REPOSITORY}.git/info/refs?service=git-upload-pack`,
		{ headers: { "Cache-Control": "no-cache" }, redirect: "error", signal },
	);
	const commit = findPublishedCommit(await readBoundedBody(refs), branch);
	const response = await fetch(new URL(`../${commit}/snapshot.json`, source), {
		redirect: "error",
		signal,
	});
	const json = new TextDecoder().decode(await readBoundedBody(response));
	return sharedBlocklistSnapshotSchema.parse(JSON.parse(json));
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
		entries: snapshot.entries.filter((entry) =>
			isSharedBlocklistEntryActive(entry.expiresAt, now),
		),
	};
}
