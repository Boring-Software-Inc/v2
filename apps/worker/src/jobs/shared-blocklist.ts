import {
	type NormalizedEvent,
	PILOT_TRIGGER_KINDS,
	SHARED_BLOCKLIST_RULE_REF,
	type SharedBlocklistEvidence,
	type SharedBlocklistSnapshot,
	sharedBlocklistMatchSchema,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import {
	isSharedBlocklistEntryActive,
	isSharedBlocklistFresh,
} from "@tripwire/utils/shared-blocklist";

export function sharedBlocklistEvidence(
	event: NormalizedEvent,
	snapshot: SharedBlocklistSnapshot | null,
	now: number,
): SharedBlocklistEvidence | null {
	if (
		event.forge !== "github" ||
		!PILOT_TRIGGER_KINDS.includes(event.kind) ||
		!sharedBlocklistMatchSchema.shape.accountId.safeParse(
			event.actor.externalId,
		).success ||
		!snapshot ||
		!isSharedBlocklistFresh(snapshot, now)
	)
		return null;
	const entry = snapshot.entries.find(
		(item) =>
			item.accountId === event.actor.externalId &&
			isSharedBlocklistEntryActive(item.expiresAt, now),
	);
	return entry
		? {
				accountId: entry.accountId,
				reason: entry.reason,
				revision: snapshot.revision,
			}
		: { revision: snapshot.revision };
}

export function sharedBlocklistReviewWorkflow(): WorkflowDefinition {
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
				config: {},
			},
			{ id: "review", type: "action", action: "send-to-moderation" },
		],
		edges: [
			{ id: "check-author", from: "opened", to: "listed-author" },
			{ id: "review-match", from: "listed-author", to: "review", when: "fail" },
		],
	};
}
