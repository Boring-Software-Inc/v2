import type { ForgeId } from "@tripwire/contracts";
import { ForgeMark } from "#/components/common/forge-marks";
import { External, Icon } from "#/design-system/icon";
import { buttonVariants } from "#/design-system/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import type { ForgeLink } from "#/lib/activity-links";

export function ForgeLinkButton({
	forge,
	link,
}: {
	forge: ForgeId;
	link: ForgeLink;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<a
						aria-label={link.label}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
						href={link.href}
						rel="noreferrer"
						target="_blank"
					>
						<ForgeMark forge={forge} />
						<Icon icon={External} size={12} />
					</a>
				}
			/>
			<TooltipContent>{link.label}</TooltipContent>
		</Tooltip>
	);
}
