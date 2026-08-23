import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "#/lib/utils";

/**
 * An icon-only pill that animates its width open on hover to spell out its
 * label, and stays open while it's the active route so the current page reads
 * itself. Used for the app sub-nav and the repo feature shortcuts on Home — a
 * compact row that only takes the space it needs until you point at it.
 *
 * The label lives in a max-width:0 → max-width track; growing max-width (plus
 * the leading pad) is what animates. `title`/`aria-label` carry the label for
 * pointer tooltips and screen readers even while it's collapsed.
 */
export function NavChip({
	to,
	label,
	icon,
	exact = true,
	className,
}: {
	to: string;
	label: string;
	icon: IconSvgElement;
	exact?: boolean;
	className?: string;
}) {
	return (
		<Link
			to={to}
			activeOptions={{ exact }}
			activeProps={{ className: "active" }}
			aria-label={label}
			title={label}
			className={cn(
				"group flex h-8 items-center rounded-md border bg-surface-1 px-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground [&.active]:bg-surface-2 [&.active]:text-foreground",
				className,
			)}
		>
			<HugeiconsIcon
				className="shrink-0"
				icon={icon}
				size={15}
				strokeWidth={1.9}
			/>
			<span className="max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium opacity-0 transition-[max-width,padding-inline-start,opacity] duration-200 ease-out group-hover:max-w-[9rem] group-hover:ps-1.5 group-hover:opacity-100 [.active_&]:max-w-[9rem] [.active_&]:ps-1.5 [.active_&]:opacity-100">
				{label}
			</span>
		</Link>
	);
}
