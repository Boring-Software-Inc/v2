import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Icon, More, Settings } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLinkItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/design-system/ui/dropdown-menu";

type RuleSettingsTarget = {
	org: string;
	repo: string;
	ruleId: string;
	name: string;
};

function RuleSettingsItem({
	org,
	repo,
	ruleId,
}: Omit<RuleSettingsTarget, "name">) {
	return (
		<DropdownMenuLinkItem
			render={
				<Link
					params={{ org, repo, ruleId }}
					to="/$org/$repo/rules/$ruleId/settings"
				/>
			}
		>
			<Icon icon={Settings} />
			Rule settings
		</DropdownMenuLinkItem>
	);
}

export function RuleSettingsMenu({
	name,
	children,
	showSettings = true,
	...target
}: RuleSettingsTarget & { children?: ReactNode; showSettings?: boolean }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`Actions for ${name}`}
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<Icon icon={More} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" size="sm">
				{showSettings && <RuleSettingsItem {...target} />}
				{showSettings && children && <DropdownMenuSeparator />}
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
