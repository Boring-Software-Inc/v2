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
				"flex items-start gap-2 rounded-panel",
				note ? "bg-hover px-2 py-2" : "min-h-6 px-0.5",
			)}
		>
			<Icon className="text-text-3" icon={icon} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="type-body-sm text-text-2">{label}</span>
				{note ? <span className="type-caption text-text-2">{note}</span> : null}
			</div>
		</div>
	);
}
