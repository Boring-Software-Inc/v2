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

export type IngestedGithubEvent = keyof typeof INGESTED_GITHUB_WEBHOOKS;

function isIngestedEvent(eventName: string): eventName is IngestedGithubEvent {
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

/** What Tripwire knows about a delivery's target, looked up by GitHub's ids. */
export interface GithubDeliveryTarget {
	/** An org has claimed the delivery's installation. */
	installationClaimed: boolean;
	/** The repo row with the delivery's repository id; null when there is none. */
	repo: {
		armed: boolean;
		/** The repo belongs to an org. */
		claimed: boolean;
		removed: boolean;
		/** An enabled workflow on the repo has a push trigger. */
		pushTriggered: boolean;
	} | null;
}

const armed = (target: GithubDeliveryTarget) =>
	target.repo !== null && !target.repo.removed && target.repo.armed;

/**
 * Which deliveries ingest must store, written apart from the ingest router so
 * the two check each other: the webhook tests send every case through ingest
 * and compare, and the delivery audit compares GitHub's delivery log with the
 * events table. Changing what Tripwire keeps means changing both.
 */
const MUST_STORE = {
	// Installation events sync repos, and claiming an installation reads them.
	installation: () => true,
	installation_repositories: () => true,
	// Backfill, rule previews and the onboarding PR picker read the PR
	// lifecycle of every claimed repo. A PR on a repo with no row yet adds it.
	pull_request: (target) =>
		target.repo === null
			? target.installationClaimed
			: !target.repo.removed && (target.repo.armed || target.repo.claimed),
	issues: armed,
	issue_comment: armed,
	push: (target) => armed(target) && target.repo?.pushTriggered === true,
} satisfies Record<
	IngestedGithubEvent,
	(target: GithubDeliveryTarget) => boolean
>;

/**
 * Whether ingest must store this delivery, provided it normalizes to an event:
 * bot and label-only edits normalize to nothing and are never stored.
 */
export function githubDeliveryMustBeStored(
	eventName: string,
	action: string | undefined,
	target: GithubDeliveryTarget,
): boolean {
	if (
		!isIngestedGithubWebhook(eventName, action) ||
		!isIngestedEvent(eventName)
	)
		return false;
	return MUST_STORE[eventName](target);
}
