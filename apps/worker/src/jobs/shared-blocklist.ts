import {
	type RepoScopedEvent,
	SHARED_BLOCKLIST_MAX_AGE_MS,
	SHARED_BLOCKLIST_RULE_REF,
	SHARED_BLOCKLIST_SOURCE,
	type SharedBlocklistSnapshot,
	sharedBlocklistSnapshotSchema,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import type { Logger } from "pino";

const REFRESH_MS = 60_000;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

function fresh(snapshot: SharedBlocklistSnapshot, now: number): boolean {
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
	logger: Logger,
): Promise<SharedBlocklistSnapshot | null> {
	if (refreshing) {
		await refreshing;
	} else if (Date.now() >= refreshAfter) {
		refreshing = (async () => {
			try {
				const next = await readSnapshot();
				if (
					!fresh(next, Date.now()) ||
					(cached && next.revision < cached.revision)
				) {
					throw new Error(
						"Snapshot is stale or older than the last accepted revision",
					);
				}
				cached = next;
			} catch {
				logger.warn("Shared blocklist snapshot could not be refreshed");
			} finally {
				refreshAfter = Date.now() + REFRESH_MS;
				refreshing = null;
			}
		})();
		await refreshing;
	}
	return cached && fresh(cached, Date.now()) ? cached : null;
}

export function sharedBlocklistReviewWorkflow(
	event: RepoScopedEvent,
	snapshot: SharedBlocklistSnapshot | null,
	now: number,
): WorkflowDefinition | null {
	if (
		event.forge !== "github" ||
		event.kind !== "change-request.opened" ||
		!snapshot ||
		!fresh(snapshot, now)
	)
		return null;
	const entry = snapshot.entries.find(
		(item) =>
			item.accountId === event.actor.externalId &&
			Date.parse(item.expiresAt) > now,
	);
	if (!entry) return null;

	return {
		id: "shared-spam-blocklist-review",
		name: "Shared spam blocklist review",
		version: 1,
		nodes: [
			{ id: "opened", type: "trigger", kinds: ["change-request.opened"] },
			{
				id: "listed-author",
				type: "rule",
				ref: SHARED_BLOCKLIST_RULE_REF,
				config: {
					accountId: entry.accountId,
					reason: entry.reason,
					revision: snapshot.revision,
				},
			},
			{ id: "review", type: "action", action: "send-to-moderation" },
		],
		edges: [
			{ id: "check-author", from: "opened", to: "listed-author" },
			{ id: "review-match", from: "listed-author", to: "review", when: "fail" },
		],
	};
}
