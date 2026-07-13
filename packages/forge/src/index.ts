import type { CheckState, NormalizedEvent, Verdict } from "@tripwire/contracts";

/**
 * @tripwire/forge — the seam. The `ForgeAdapter` interface + supporting types.
 * NOTHING ELSE, EVER. Implementations are siblings (`forge-github`, later
 * `forge-gitlab`) that never import each other.
 *
 * Three responsibilities (spec §4): inbound (verify + normalize), reads (build
 * `RuleContext` inputs), actions (block / label / comment / setCheck — the
 * forge's native merge-gating primitive), all idempotent.
 */

/** A webhook delivery exactly as the forge sent it, before any parsing. */
export interface RawForgeEvent {
	/** The forge's delivery id (GitHub: X-GitHub-Delivery). */
	deliveryId: string;
	/** The forge's event name (GitHub: X-GitHub-Event). */
	eventName: string;
	/** The raw request body, verbatim. */
	body: string;
	/** Signature header for HMAC verification, when present. */
	signature: string | null;
}

/** One file in a change request's diff. */
export interface DiffFile {
	path: string;
	status: "added" | "modified" | "removed" | "renamed";
	additions: number;
	deletions: number;
	/** Unified diff hunk text, when the forge provides it. */
	patch?: string;
	previousPath?: string;
}

export interface ForgeCommit {
	sha: string;
	message: string;
	authorLogin: string | null;
	authorEmail: string | null;
	authoredAt: string;
}

/** The social-layer profile of a contributor, pre-fetched for rules/scoring. */
export interface ContributorProfile {
	login: string;
	externalId: string;
	createdAt: string;
	followers: number;
	following: number;
	publicRepos: number;
	/** Profile README / bio text, when the forge exposes one. */
	profileText: string | null;
	/** Merged change requests by this contributor in the subject repo. */
	mergedInRepo: number;
	/**
	 * Merged change requests by this contributor in repos they do NOT own — the
	 * "someone else accepted their work" signal (min-merged-prs@2). null when the
	 * read failed, so the rule can skip honestly rather than guess.
	 */
	mergedElsewhere: number | null;
	/** ISO timestamps of the contributor's recent change requests, newest first. */
	recentChangeRequestTimes: string[];
	/** Whether the contributor is a member/owner of the repo's org. */
	isOrgMember: boolean;
	/** Whether the contributor has write access to the repo (maintainer). */
	isMaintainer: boolean;
}

export type ForgeAction =
	| { kind: "block"; repoFullName: string; number: number; reason: string }
	| { kind: "label"; repoFullName: string; number: number; labels: string[] }
	| {
			kind: "comment";
			repoFullName: string;
			number: number;
			/** Full markdown body including the tripwire marker. Upsert, never append. */
			body: string;
	  }
	| { kind: "request-review"; repoFullName: string; number: number }
	| { kind: "set-check"; repoFullName: string; check: CheckState };

/** The result of executing an action — the forge-side artifact id, if any. */
export interface ForgeActionResult {
	externalId: string | null;
}

export interface ForgeAdapter {
	readonly forge: "github";

	/** Inbound: constant-time HMAC verification of a webhook delivery. */
	verifyWebhook(event: RawForgeEvent, secret: string): boolean;

	/**
	 * Inbound: raw payload → NormalizedEvent, or null for event kinds Tripwire
	 * does not ingest. Parse failures throw — the worker quarantines (§5.5).
	 */
	normalizeWebhook(
		event: RawForgeEvent,
		receivedAt: string,
	): NormalizedEvent | null;

	/** Reads — everything rules may need, pre-fetched by the worker (§5.8). */
	getDiff(repoFullName: string, number: number): Promise<DiffFile[]>;
	getCommits(repoFullName: string, number: number): Promise<ForgeCommit[]>;
	readFile(
		repoFullName: string,
		path: string,
		ref: string,
	): Promise<string | null>;
	getContributorProfile(
		repoFullName: string,
		login: string,
	): Promise<ContributorProfile>;

	/** Actions — idempotent; comment/check upsert their existing artifact. */
	execute(action: ForgeAction): Promise<ForgeActionResult>;
}

export type { CheckState, NormalizedEvent, Verdict };
