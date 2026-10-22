import { defineCollection } from "#/lib/collection";
import type { SwitcherRepo } from "#/lib/onboarding.functions";

const byActivity = (a: SwitcherRepo, b: SwitcherRepo) =>
	(b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "");

export const ORG_REPOS_COLLECTION = defineCollection<SwitcherRepo>({
	id: "org-repos",
	noun: "repos",
	search: {
		placeholder: "Search repos",
		fields: (repo) => [repo.fullName],
	},
	filters: [
		{
			key: "attention",
			label: "Needs attention",
			kind: "toggle",
			match: (repo) => repo.pendingModeration > 0 || repo.blocked24h > 0,
		},
	],
	sort: [
		{
			key: "attention",
			label: "Attention",
			compare: (a, b) =>
				b.pendingModeration - a.pendingModeration ||
				b.blocked24h - a.blocked24h ||
				byActivity(a, b),
		},
		{
			key: "name",
			label: "Name",
			compare: (a, b) => a.fullName.localeCompare(b.fullName),
		},
		{ key: "activity", label: "Last activity", compare: byActivity },
	],
	defaultSort: "attention",
});
