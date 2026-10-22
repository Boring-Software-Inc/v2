import { defineCollection } from "#/lib/collection";
import type { WorkflowListItem } from "#/lib/workflows.functions";

export function humanizeTriggerKind(kind: string): string {
	return kind.replace(/[.-]/g, " ");
}

export const WORKFLOWS_COLLECTION = defineCollection<WorkflowListItem>({
	id: "workflows",
	noun: "workflows",
	search: {
		placeholder: "Search workflows",
		fields: (workflow) => [
			workflow.name,
			...workflow.triggerKinds.map(humanizeTriggerKind),
		],
	},
	filters: [
		{
			key: "status",
			label: "Status",
			kind: "select",
			options: [
				{ value: "live", label: "Live", match: (workflow) => workflow.enabled },
				{ value: "off", label: "Off", match: (workflow) => !workflow.enabled },
			],
		},
	],
	sort: [
		{
			key: "updated",
			label: "Updated",
			compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
		},
		{
			key: "name",
			label: "Name",
			compare: (a, b) => a.name.localeCompare(b.name),
		},
	],
	defaultSort: "updated",
});
