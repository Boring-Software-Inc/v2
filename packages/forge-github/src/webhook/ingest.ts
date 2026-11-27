import { z } from "zod";

/**
 * The GitHub deliveries Tripwire reads, by event and action. `normalizeWebhook`
 * returns null for everything else, and storing it costs a row (~9 KB of raw
 * JSON) per delivery: on staging that was 60% of webhooks, led by
 * `issue_comment.edited`, review events and `check_suite`, which GitHub sends
 * to every App with checks access whether it subscribed or not.
 *
 * `null` means every action (push has none). Keep in step with the normalizer:
 * `webhook.test.ts` asserts no delivery it turns into an event is dropped.
 * GitHub never redelivers on its own, so a dropped delivery is gone.
 */
const INGESTED_GITHUB_WEBHOOKS = {
	pull_request: [
		"opened",
		"reopened",
		"ready_for_review",
		"synchronize",
		"edited",
		"closed",
	],
	issues: ["opened"],
	issue_comment: ["created"],
	push: null,
	installation: ["created", "deleted"],
	installation_repositories: ["added", "removed"],
} satisfies Record<string, readonly string[] | null>;

/** The `action` most deliveries carry; absent on push. */
export const githubDeliveryActionSchema = z.object({
	action: z.string().optional(),
});

function isIngestedEvent(
	eventName: string,
): eventName is keyof typeof INGESTED_GITHUB_WEBHOOKS {
	return Object.hasOwn(INGESTED_GITHUB_WEBHOOKS, eventName);
}

/** Whether a delivery can normalize to something Tripwire acts on. */
export function isIngestedGithubWebhook(
	eventName: string,
	action: string | undefined,
): boolean {
	if (!isIngestedEvent(eventName)) return false;
	const actions: readonly string[] | null = INGESTED_GITHUB_WEBHOOKS[eventName];
	return actions === null || (action !== undefined && actions.includes(action));
}
