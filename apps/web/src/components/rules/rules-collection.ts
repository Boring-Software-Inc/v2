import { defineCollection } from "#/lib/collection";
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
	filters: [
		{
			key: "show",
			label: "Show rules",
			kind: "segment",
			allLabel: "All",
			optionsFrom: (rules) => [
				{ value: "active", label: "Active", match: (rule) => rule.enabled },
				...(rules.some((rule) => rule.management === "managed")
					? [
							{
								value: "workflows",
								label: "In workflows",
								match: (rule: RuleConfigView) => rule.management === "managed",
							},
						]
					: []),
				{
					value: "custom",
					label: "Custom",
					match: (rule) => rule.source === "custom",
				},
			],
		},
	],
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
