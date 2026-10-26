import { z } from "zod";

export interface RulePack {
	id: string;
	name: string;
	ruleIds: readonly string[];
	recommended: boolean;
}

export const RULE_PACKS: readonly RulePack[] = [
	{
		id: "spam-protection",
		name: "Spam protection",
		ruleIds: ["account-age", "pr-rate-limit", "english-only"],
		recommended: true,
	},
	{
		id: "crypto-scams",
		name: "Crypto scams",
		ruleIds: ["crypto-address", "honeypot"],
		recommended: false,
	},
	{
		id: "first-time-contributors",
		name: "First-time contributors",
		ruleIds: ["min-merged-prs", "profile-readme"],
		recommended: false,
	},
	{
		id: "bulk-changes",
		name: "Bulk changes",
		ruleIds: ["max-files-changed"],
		recommended: false,
	},
];

export const RECOMMENDED_RULE_IDS: readonly string[] = [
	"account-age",
	"crypto-address",
];

export const RULE_FALLBACK_ORDER: readonly string[] = [
	"account-age",
	"crypto-address",
	"pr-rate-limit",
	"english-only",
	"honeypot",
	"min-merged-prs",
	"profile-readme",
	"max-files-changed",
	"ai-review",
];

export const MOST_USED_MIN_REPOS = 10;

export interface RuleUsage {
	repos: number;
	byRule: Readonly<Record<string, number>>;
}

export function mostUsedOrder(
	ruleIds: readonly string[],
	usage: RuleUsage | null,
): string[] {
	const fallback = (id: string) => {
		const index = RULE_FALLBACK_ORDER.indexOf(id);
		return index === -1 ? RULE_FALLBACK_ORDER.length : index;
	};
	const ranked = usage !== null && usage.repos >= MOST_USED_MIN_REPOS;
	return [...ruleIds].sort(
		(a, b) =>
			(ranked ? (usage.byRule[b] ?? 0) - (usage.byRule[a] ?? 0) : 0) ||
			fallback(a) - fallback(b),
	);
}

export const RULE_PREVIEW_WINDOW_DAYS = 30;
export const RULE_PREVIEW_MAX_CHANGE_REQUESTS = 500;
export const RULE_PREVIEW_MAX_EXAMPLES = 5;
export const RULE_PREVIEW_MAX_AGE_MS = 60 * 60 * 1000;

export const rulePreviewCatchSchema = z.object({
	number: z.number().int(),
	title: z.string(),
	author: z.string(),
	reason: z.string().nullable(),
});
export type RulePreviewCatch = z.infer<typeof rulePreviewCatchSchema>;

export const rulePreviewRuleSchema = z.object({
	ruleId: z.string(),
	caught: z.array(z.number().int()).nullable(),
	caughtEvents: z
		.array(z.object({ number: z.number().int(), eventId: z.string() }))
		.optional(),
	examples: z.array(rulePreviewCatchSchema).max(RULE_PREVIEW_MAX_EXAMPLES),
});
export type RulePreviewRule = z.infer<typeof rulePreviewRuleSchema>;

export const rulePreviewChangeRequestSchema = z.object({
	number: z.number().int(),
	title: z.string(),
	author: z.string(),
});
export type RulePreviewChangeRequest = z.infer<
	typeof rulePreviewChangeRequestSchema
>;

export const rulePreviewSchema = z.object({
	windowDays: z.number().int().positive(),
	changeRequests: z.number().int().nonnegative(),
	rules: z.array(rulePreviewRuleSchema),
	recent: z
		.array(rulePreviewChangeRequestSchema)
		.max(RULE_PREVIEW_MAX_CHANGE_REQUESTS)
		.default([]),
});
export type RulePreview = z.infer<typeof rulePreviewSchema>;

export function previewCaught(
	preview: RulePreview | null,
	ruleIds: readonly string[],
): number | null {
	if (preview === null) {
		return null;
	}
	const numbers = new Set<number>();
	for (const id of ruleIds) {
		const rule = preview.rules.find((entry) => entry.ruleId === id);
		if (!rule?.caught) {
			return null;
		}
		for (const number of rule.caught) {
			numbers.add(number);
		}
	}
	return numbers.size;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonical);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, inner]) => [key, canonical(inner)]),
		);
	}
	return value;
}

export function sameSettings(a: unknown, b: unknown): boolean {
	return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function libraryGroups(
	available: readonly string[],
	mostUsed: readonly string[],
): { recommended: string[]; mostUsed: string[] } {
	const recommended = RECOMMENDED_RULE_IDS.filter((id) =>
		available.includes(id),
	);
	const rest = available.filter((id) => !recommended.includes(id));
	const ranked = mostUsed.filter((id) => rest.includes(id));
	const leftover = mostUsedOrder(
		rest.filter((id) => !ranked.includes(id)),
		null,
	);
	return { recommended, mostUsed: [...ranked, ...leftover] };
}
