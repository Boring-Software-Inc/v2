import { type GlazeIcon, Icon } from "#/design-system/icon";
import { cn } from "#/design-system/lib/utils";

export interface CollapsedBlockRowProps {
	icon: GlazeIcon;
	label: string;
	note?: string;
}

export function CollapsedBlockRow({
	icon,
	label,
	note,
}: CollapsedBlockRowProps) {
	return (
		<div
			className={cn(
				"flex min-h-6 items-center gap-2 rounded-panel px-0.5",
				note && "text-text-3",
			)}
		>
			<Icon className="text-text-3" icon={icon} />
			<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
				<span className="type-body-sm text-text-2">{label}</span>
				{note ? <span className="type-caption text-text-3">{note}</span> : null}
			</div>
		</div>
	);
}
