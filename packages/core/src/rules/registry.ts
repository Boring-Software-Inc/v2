import { accountAge } from "./account-age.ts";
import { aiReview } from "./ai-review/rule.ts";
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

/** Looks up `account-age@1`-style refs. Unknown refs are the caller's skipped case. */
export function getRule(ref: string): RuleDefinition | null {
	return registry.get(ref) ?? null;
}

export function listRules(): { ref: string; rule: RuleDefinition }[] {
	return [...registry.entries()].map(([ref, rule]) => ({ ref, rule }));
}
