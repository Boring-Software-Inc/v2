import { type GlazeIcon, Icon } from "#/components/glaze/icon";
import { cn } from "#/lib/glaze/utils";

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
				"flex items-center gap-2.5 rounded-panel",
				note ? "h-8 bg-hover px-2.5" : "h-6 px-0.5",
			)}
		>
			<Icon className="text-text-3" icon={icon} />
			<span className="min-w-0 flex-1 truncate type-body-sm text-text-2">
				{label}
			</span>
			{note ? <span className="type-caption text-text-3">{note}</span> : null}
		</div>
	);
}
