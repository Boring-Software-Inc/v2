import { Link } from "@tanstack/react-router";
import { ChevronDown, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLinkItem,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";

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
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`${ruleName}: ${label}`}
						size="sm"
						variant="ghost"
					/>
				}
			>
				{label}
				<Icon icon={ChevronDown} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" size="sm">
				{usedInLinks(org, repo, workflows).map((link) => (
					<DropdownMenuLinkItem
						key={link.key}
						render={
							<Link
								params={link.params}
								to="/$org/$repo/workflows/$workflowId"
							/>
						}
					>
						{link.name}
					</DropdownMenuLinkItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
