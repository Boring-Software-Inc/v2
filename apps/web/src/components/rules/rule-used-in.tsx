import { Button } from "@tripwire/ui/button";
import { ChevronDown, Icon } from "@tripwire/ui/icon";
import { Menu } from "@tripwire/ui/menu";

export function usedInLabel(count: number): string {
	return `Used in ${count} ${count === 1 ? "workflow" : "workflows"}`;
}

export function usedInLinks(
	org: string,
	repo: string,
	workflows: readonly { id: string; name: string }[],
) {
	return workflows.map((workflow) => ({
		key: workflow.id,
		name: workflow.name,
		params: { org, repo, workflowId: workflow.id },
	}));
}

export function RuleUsedIn({
	org,
	repo,
	ruleName,
	workflows,
}: {
	org: string;
	repo: string;
	ruleName: string;
	workflows: readonly { id: string; name: string }[];
}) {
	const label = usedInLabel(workflows.length);
	return (
		<Menu
			align="end"
			ariaLabel={`${ruleName}: ${label}`}
			items={usedInLinks(org, repo, workflows).map((link) => ({
				href: `/${org}/${repo}/workflows/${link.key}`,
				label: link.name,
				type: "link" as const,
				value: link.key,
			}))}
			trigger={
				<Button
					ariaLabel={`${ruleName}: ${label}`}
					size="small"
					variant="ghost"
				>
					{label}
					<Icon icon={ChevronDown} />
				</Button>
			}
		/>
	);
}
