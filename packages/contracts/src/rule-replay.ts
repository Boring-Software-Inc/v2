import { RULE_PACKS, type RulePreview } from "./rule-packs.ts";
import { ruleDisplayName } from "./rules.ts";

export type ReplayVerdict = "blocked" | "passed";

export interface ReplayRow {
	number: number;
	title: string;
	author: string;
	verdict: ReplayVerdict;
	ruleId: string | null;
}

export interface RuleReplay {
	ruleIds: string[];
	rows: ReplayRow[];
	blocked: number;
	windowDays: number;
}

export function replayRules(
	preview: RulePreview | null,
	ruleIds: readonly string[],
): RuleReplay | null {
	if (preview === null || preview.recent.length === 0) {
		return null;
	}
	const known: string[] = [];
	const caughtBy = new Map<number, string>();
	for (const id of ruleIds) {
		const caught = preview.rules.find((rule) => rule.ruleId === id)?.caught;
		if (!caught) {
			continue;
		}
		known.push(id);
		for (const number of caught) {
			if (!caughtBy.has(number)) {
				caughtBy.set(number, id);
			}
		}
	}
	if (known.length === 0) {
		return null;
	}
	const rows = preview.recent.map((cr): ReplayRow => {
		const ruleId = caughtBy.get(cr.number) ?? null;
		return {
			number: cr.number,
			title: cr.title,
			author: cr.author,
			verdict: ruleId ? "blocked" : "passed",
			ruleId,
		};
	});
	return {
		ruleIds: known,
		rows,
		blocked: rows.filter((row) => row.verdict === "blocked").length,
		windowDays: preview.windowDays,
	};
}

function joinNames(names: readonly string[]): string {
	if (names.length <= 1) {
		return names[0] ?? "";
	}
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function ruleSetNames(ruleIds: readonly string[]): string[] {
	const covered = new Set<string>();
	const names: string[] = [];
	for (const pack of RULE_PACKS) {
		if (pack.ruleIds.every((id) => ruleIds.includes(id))) {
			names.push(pack.name);
			for (const id of pack.ruleIds) {
				covered.add(id);
			}
		}
	}
	for (const id of ruleIds) {
		if (!covered.has(id)) {
			names.push(ruleDisplayName(id));
		}
	}
	return names;
}

export function ruleSetLabel(ruleIds: readonly string[]): string {
	return joinNames(ruleSetNames(ruleIds));
}
