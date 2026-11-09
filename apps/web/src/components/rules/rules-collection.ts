import { z } from "zod";
import { collectionSearchSchema, defineCollection } from "#/lib/collection";
import type { RuleConfigView } from "#/lib/rules.functions";

type PilotRuleListItem = Pick<
	RuleConfigView,
	"name" | "ruleId" | "blurb" | "sentence" | "matches24h"
> & { kind: "pilot" };

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name);

export const RULES_COLLECTION = defineCollection<
	RuleConfigView | PilotRuleListItem
>({
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

export const RULES_TABS = ["installed", "library", "custom"] as const;
export type RulesTab = (typeof RULES_TABS)[number];

const collectionSearch = collectionSearchSchema(RULES_COLLECTION);
const tabSearch = z.object({
	tab: z.enum(RULES_TABS).optional().catch(undefined),
});

interface RulesSearch extends z.output<typeof collectionSearch> {
	tab?: RulesTab;
}

export function parseRulesSearch(
	search: Parameters<typeof tabSearch.parse>[0],
) {
	const { tab } = tabSearch.parse(search);
	const parsed: RulesSearch = collectionSearch.parse(search);
	if (tab) {
		parsed.tab = tab;
	}
	return parsed;
}
