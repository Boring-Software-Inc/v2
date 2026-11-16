import type { ForgeId } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { External, Icon } from "@tripwire/ui/icon";
import { Tooltip } from "@tripwire/ui/tooltip";
import { ForgeMark } from "#/components/common/forge-marks";
import type { ForgeLink } from "#/lib/activity-links";

export function ForgeLinkButton({
	forge,
	link,
}: {
	forge: ForgeId;
	link: ForgeLink;
}) {
	return (
		<Tooltip
			trigger={
				<Button
					ariaLabel={link.label}
					href={link.href}
					openInNewTab
					size="small"
					variant="ghost"
				>
					<ForgeMark forge={forge} />
					<Icon icon={External} size={12} />
				</Button>
			}
		>
			{link.label}
		</Tooltip>
	);
}
