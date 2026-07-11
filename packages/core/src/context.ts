import type { NormalizedEvent } from "@tripwire/contracts";

/**
 * RuleContext — everything a rule may read, pre-fetched by the worker (§5.8).
 * Core is pure: these are plain data shapes, structurally compatible with the
 * adapter's read results; the worker does the mapping. The clock is an input
 * (`now`) so every rule is deterministic over its context.
 */

export interface ContextDiffFile {
	path: string;
	status: "added" | "modified" | "removed" | "renamed";
	additions: number;
	deletions: number;
	patch?: string;
}

export interface ContextCommit {
	sha: string;
	message: string;
	authorLogin: string | null;
	authoredAt: string;
}

export interface ContextContributor {
	login: string;
	/** ISO — account creation time on the forge. */
	createdAt: string;
	followers: number;
	publicRepos: number;
	/** Profile README / bio text; null when the forge has none. */
	profileText: string | null;
	/** Merged change requests by this contributor in the subject repo. */
	mergedInRepo: number;
	/** ISO timestamps of the contributor's recent change requests, newest first. */
	recentChangeRequestTimes: string[];
	isOrgMember: boolean;
	isMaintainer: boolean;
}

/**
 * §8 inversion: ai-review's effect arrives INJECTED — core never imports the
 * AI SDK. The worker supplies an implementation wrapping the bounded tool
 * loop; `output` is validated by the rule, `trace` persists as evidence.
 */
export interface AiReviewRequest {
	model: string;
	maxSteps: number;
	instructions: string;
	prompt: string;
}

export interface AiReviewResponse {
	output: unknown;
	/** Full trace: messages, tool calls, tokens, cost — "show me why". */
	trace: unknown;
}

export type AiReviewGenerate = (
	request: AiReviewRequest,
) => Promise<AiReviewResponse>;

export interface RuleContext {
	event: NormalizedEvent;
	/** ISO — the evaluation clock. Determinism: time is an input. */
	now: string;
	/** null ⇒ the read was unavailable; rules skip, never throw (§6). */
	diff: ContextDiffFile[] | null;
	commits: ContextCommit[] | null;
	contributor: ContextContributor | null;
	/** Injected by the worker when AI credentials exist (§8). */
	generate?: AiReviewGenerate;
}
