import { accountAge } from "./account-age.ts";
import { aiReview, aiReviewV2 } from "./ai-review/rule.ts";
import { cryptoAddress } from "./crypto-address.ts";
import { type RuleDefinition, ruleRef } from "./define.ts";
import { englishOnly } from "./english-only.ts";
import { honeypot } from "./honeypot.ts";
import { maxFilesChanged } from "./max-files-changed.ts";
import { minMergedPrs } from "./min-merged-prs.ts";
import { prRateLimit } from "./pr-rate-limit.ts";
import { profileReadme } from "./profile-readme.ts";

/**
 * The typed registry, keyed by `id@version` (§6 versioning law): a stored run
 * references `account-age@1` forever, even after `@2` ships. Registrations
 * are append-only — a version is never re-bound.
 */
const registry = new Map<string, RuleDefinition>();

function register(rule: RuleDefinition): void {
	const ref = ruleRef(rule);
	if (registry.has(ref)) {
		throw new Error(`duplicate rule registration: ${ref}`);
	}
	registry.set(ref, rule);
}

register(accountAge);
register(minMergedPrs);
register(prRateLimit);
register(maxFilesChanged);
register(englishOnly);
register(cryptoAddress);
register(honeypot);
register(profileReadme);
register(aiReview);
register(aiReviewV2);

/** Looks up `account-age@1`-style refs. Unknown refs are the caller's skipped case. */
export function getRule(ref: string): RuleDefinition | null {
	return registry.get(ref) ?? null;
}

export function listRules(): { ref: string; rule: RuleDefinition }[] {
	return [...registry.entries()].map(([ref, rule]) => ({ ref, rule }));
}

/**
 * Rules that deliberately expose NO public evidence (§10). Empty today — every
 * launch rule has a public partition. A future rule may opt out here WITH a
 * reason; the public-view test fails on any rule that neither defines both
 * members nor appears here (so a rule can't silently ship without a decision).
 */
export const PUBLIC_VIEW_OPT_OUT: Record<string, string> = {};

export interface RulePublicProjection {
	/** Contributor-facing evidence subset, or null when none is safe. */
	publicEvidence: Record<string, unknown> | null;
	/** Plain-English outcome, or null when it can't be derived. */
	summary: string | null;
}

/**
 * §10 — project a rule's evidence to its public partition + one-liner, called
 * by the worker at persist time (the only legal importer of core). Safe by
 * default: an unknown/opted-out rule or non-record evidence (e.g. a skipped
 * rule's null evidence) yields no public evidence.
 */
export function projectRulePublic(
	ref: string,
	evidence: unknown,
): RulePublicProjection {
	const rule = getRule(ref);
	if (
		!rule ||
		typeof evidence !== "object" ||
		evidence === null ||
		Array.isArray(evidence)
	) {
		return { publicEvidence: null, summary: null };
	}
	const ev = evidence as Record<string, unknown>;
	return {
		publicEvidence: rule.publicEvidence ? rule.publicEvidence(ev) : null,
		summary: rule.summarize ? rule.summarize(ev) : null,
	};
}
