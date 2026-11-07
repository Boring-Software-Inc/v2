import {
	type RepoScopedEvent,
	SHARED_BLOCKLIST_RULE_REF,
	type SharedBlocklistSnapshot,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import {
	isSharedBlocklistEntryActive,
	isSharedBlocklistFresh,
} from "@tripwire/utils/shared-blocklist";

export function sharedBlocklistReviewWorkflow(
	event: RepoScopedEvent,
	snapshot: SharedBlocklistSnapshot | null,
	now: number,
): WorkflowDefinition | null {
	if (
		event.forge !== "github" ||
		event.kind !== "change-request.opened" ||
		!snapshot ||
		!isSharedBlocklistFresh(snapshot, now)
	)
		return null;
	const entry = snapshot.entries.find(
		(item) =>
			item.accountId === event.actor.externalId &&
			isSharedBlocklistEntryActive(item.expiresAt, now),
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
