import { Button } from "@tripwire/ui/button";
import { Icon, More, Settings } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";

type RuleSettingsTarget = {
	org: string;
	repo: string;
	ruleId: string;
	name: string;
};

export function RuleSettingsMenu({
	items = [],
	name,
	showSettings = true,
	...target
}: RuleSettingsTarget & {
	items?: readonly MenuEntry[];
	showSettings?: boolean;
}) {
	const menuItems: MenuEntry[] = [
		...(showSettings
			? [
					{
						href: `/${target.org}/${target.repo}/rules/${target.ruleId}/settings`,
						icon: <Icon icon={Settings} />,
						label: "Rule settings",
						type: "link" as const,
						value: "rule-settings",
					},
				]
			: []),
		...(showSettings && items.length > 0
			? [{ type: "separator" as const, value: "rule-settings-separator" }]
			: []),
		...items,
	];
	return (
		<Menu
			align="end"
			ariaLabel={`Actions for ${name}`}
			items={menuItems}
			trigger={
				<Button ariaLabel={`Actions for ${name}`} size="small" variant="ghost">
					<Icon icon={More} />
				</Button>
			}
		/>
	);
}
