import { Link } from "@tanstack/react-router";
import { type GlazeIcon, Icon } from "#/components/glaze/icon";
import { cn } from "#/lib/glaze/utils";

export function NavChip({
	to,
	label,
	icon,
	exact = true,
	className,
}: {
	to: string;
	label: string;
	icon: GlazeIcon;
	exact?: boolean;
	className?: string;
}) {
	return (
		<Link
			to={to}
			activeOptions={{ exact }}
			activeProps={{ "aria-current": "page" }}
			className={cn(
				"flex h-(--control-sm) items-center gap-1.5 rounded-pill px-2.5 type-label-sm text-text-2 ring-1 ring-line-faint hover:bg-hover hover:text-text-1 aria-[current=page]:bg-pressed aria-[current=page]:text-text-1",
				className,
			)}
		>
			<Icon icon={icon} size={12} />
			<span>{label}</span>
		</Link>
	);
}
