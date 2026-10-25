import { ruleIdOf } from "@tripwire/contracts";
import { getRule } from "./registry.ts";

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

type Evidence = Record<string, unknown>;

const num = (e: Evidence, key: string): number =>
	typeof e[key] === "number" ? (e[key] as number) : 0;

const LINES: Record<string, (e: Evidence) => string | null> = {
	"account-age": (e) =>
		`Account ${plural(num(e, "accountAgeDays"), "day", "days")} old`,
	"crypto-address": (e) =>
		Array.isArray(e.matches) && e.matches.length > 0
			? plural(e.matches.length, "wallet address", "wallet addresses")
			: null,
	"english-only": (e) =>
		`Title ${Math.round(num(e, "ratio") * 100)}% non-latin`,
	honeypot: (e) => {
		const touched = Array.isArray(e.touched) ? (e.touched as string[]) : [];
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
};

export function maintainerLine(ref: string, evidence: unknown): string | null {
	const rule = getRule(ref);
	const line = LINES[ruleIdOf(ref)];
	if (!(rule && line)) {
		return null;
	}
	const parsed = rule.resultSchema.safeParse(evidence);
	return parsed.success ? line(parsed.data as Evidence) : null;
}
