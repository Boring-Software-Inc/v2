import { type RuleResult, ruleIdOf } from "@tripwire/contracts";
import { z } from "zod";
import { getRule } from "./registry.ts";

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

const evidenceSchema = z.looseObject({
	accountAgeDays: z.number().optional(),
	matches: z.array(z.unknown()).optional(),
	ratio: z.number().optional(),
	touched: z.array(z.string()).optional(),
	filesChanged: z.number().optional(),
	mergedElsewhere: z.number().optional(),
	mergedInRepo: z.number().optional(),
	count: z.number().optional(),
	windowHours: z.number().optional(),
	hasProfileText: z.boolean().optional(),
	length: z.number().optional(),
});
type Evidence = z.infer<typeof evidenceSchema>;

const evidenceNumber = z.number().catch(0);
const num = (e: Evidence, key: string): number => evidenceNumber.parse(e[key]);

const LINES = {
	"account-age": (e) =>
		`Account ${plural(num(e, "accountAgeDays"), "day", "days")} old`,
	"crypto-address": (e) =>
		Array.isArray(e.matches) && e.matches.length > 0
			? plural(e.matches.length, "wallet address", "wallet addresses")
			: null,
	"english-only": (e) =>
		`Title ${Math.round(num(e, "ratio") * 100)}% non-latin`,
	honeypot: (e) => {
		const touched = e.touched ?? [];
		if (touched.length === 1) {
			return `Touches ${touched[0]}`;
		}
		return touched.length > 1
			? `Touches ${plural(touched.length, "protected file", "protected files")}`
			: null;
	},
	"max-files-changed": (e) =>
		`${plural(num(e, "filesChanged"), "file", "files")} changed`,
	"min-merged-prs": (e) =>
		"mergedElsewhere" in e
			? `${plural(num(e, "mergedElsewhere"), "merge", "merges")} elsewhere`
			: `${plural(num(e, "mergedInRepo"), "merge", "merges")} here`,
	"pr-rate-limit": (e) =>
		`${plural(num(e, "count"), "change request", "change requests")} in ${plural(num(e, "windowHours"), "hour", "hours")}`,
	"profile-readme": (e) =>
		e.hasProfileText === true
			? `Profile README ${plural(num(e, "length"), "character", "characters")}`
			: "No profile README",
} satisfies Record<string, (e: Evidence) => string | null>;

export function maintainerLine(
	ref: string,
	evidence: RuleResult["evidence"],
): string | null {
	const rule = getRule(ref);
	const ruleId = ruleIdOf(ref);
	if (!rule || !(ruleId in LINES)) {
		return null;
	}
	const parsed = rule.resultSchema.safeParse(evidence);
	if (!parsed.success) {
		return null;
	}
	const fields = evidenceSchema.safeParse(parsed.data);
	return fields.success
		? LINES[ruleId as keyof typeof LINES](fields.data)
		: null;
}
