import { z } from "zod";
import { collectionSearchSchema, defineCollection } from "#/lib/collection";
import type { RuleConfigView } from "#/lib/rules.functions";

const byName = (a: RuleConfigView, b: RuleConfigView) =>
	a.name.localeCompare(b.name);

export const RULES_COLLECTION = defineCollection<RuleConfigView>({
	id: "rules",
	noun: "rules",
	search: {
		placeholder: "Search rules",
		fields: (rule) => [rule.name, rule.ruleId, rule.blurb, rule.sentence],
	},
	sort: [
		{
			key: "active",
			label: "Most active",
			compare: (a, b) => b.matches24h - a.matches24h || byName(a, b),
		},
		{ key: "az", label: "A to Z", compare: byName },
	],
	defaultSort: "active",
});

export const RULES_TABS = ["on", "library", "custom"] as const;
export type RulesTab = (typeof RULES_TABS)[number];

const collectionSearch = collectionSearchSchema(RULES_COLLECTION);
const tabSearch = z.object({
	tab: z.enum(RULES_TABS).optional().catch(undefined),
});

export function parseRulesSearch(search: Record<string, unknown>) {
	const { tab } = tabSearch.parse(search);
	return {
		...collectionSearch.parse(search),
		...(tab ? { tab } : {}),
	};
}
