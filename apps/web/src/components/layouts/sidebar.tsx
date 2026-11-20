import { Icon, type IconGlyph } from "@tripwire/ui/icon";
import { Tooltip } from "@tripwire/ui/tooltip";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import type {
	ComponentPropsWithoutRef,
	ComponentPropsWithRef,
	ReactElement,
	ReactNode,
} from "react";
import { cn } from "#/lib/utils";

type SidebarFrameProps = ComponentPropsWithoutRef<"div"> & {
	secondary?: ReactNode;
	secondaryDelay?: number;
	onSecondaryExitComplete?: () => void;
};

export function SidebarFrame({
	className,
	secondary,
	secondaryDelay = 0,
	onSecondaryExitComplete,
	children,
	...props
}: SidebarFrameProps) {
	return (
		<div
			className={cn("flex h-full min-h-0 shrink-0", className)}
			data-secondary={secondary ? "" : undefined}
			data-slot="frame"
			{...props}
		>
			{children}
			<AnimatePresence onExitComplete={onSecondaryExitComplete}>
				{secondary ? (
					<SidebarSecondaryMotion entryDelay={secondaryDelay} key="secondary">
						{secondary}
					</SidebarSecondaryMotion>
				) : null}
			</AnimatePresence>
		</div>
	);
}

type SidebarPrimaryProps = ComponentPropsWithoutRef<typeof motion.nav> & {
	condensed?: boolean;
};

export function SidebarPrimary({
	className,
	condensed = false,
	...props
}: SidebarPrimaryProps) {
	return (
		<motion.nav
			className={cn("h-full min-h-0 shrink-0", className)}
			data-condensed={condensed ? "" : undefined}
			data-slot="primary"
			{...props}
		/>
	);
}

type SidebarSecondaryProps = ComponentPropsWithoutRef<typeof motion.div>;

export function SidebarSecondary({
	className,
	...props
}: SidebarSecondaryProps) {
	return (
		<motion.div
			className={cn(
				"min-h-0 w-56 shrink-0 overflow-y-auto px-1 py-2",
				className,
			)}
			data-slot="secondary"
			{...props}
		/>
	);
}

function SidebarSecondaryMotion({
	children,
	entryDelay,
}: {
	children: ReactNode;
	entryDelay: number;
}) {
	const isPresent = useIsPresent();
	const reduceMotion = useReducedMotion();
	return (
		<motion.div
			animate={{ width: 224 }}
			className="min-h-0 shrink-0 overflow-hidden"
			data-slot="secondary-rail"
			exit={{ width: 0 }}
			initial={{ width: 0 }}
			inert={isPresent ? undefined : true}
			transition={
				reduceMotion
					? { duration: 0 }
					: {
							delay: isPresent ? entryDelay : 0,
							duration: 0.18,
							ease: [0.2, 0.8, 0, 1],
						}
			}
		>
			<SidebarSecondary
				animate={{ opacity: 1, x: 0 }}
				exit={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
				initial={{ opacity: 1, x: reduceMotion ? 0 : -12 }}
				transition={
					reduceMotion
						? { duration: 0 }
						: {
								delay: isPresent ? entryDelay : 0,
								duration: isPresent ? 0.18 : 0.1,
								ease: isPresent ? [0.19, 0.91, 0.38, 1] : [0.2, 0.8, 0, 1],
							}
				}
			>
				{children}
			</SidebarSecondary>
		</motion.div>
	);
}

export function SidebarNav({
	className,
	...props
}: ComponentPropsWithRef<"nav">) {
	return (
		<nav className={cn("flex min-w-0 flex-col gap-px", className)} {...props} />
	);
}

export function SidebarNavGroup({
	className,
	...props
}: ComponentPropsWithoutRef<"div">) {
	return <div className={cn("flex flex-col gap-px", className)} {...props} />;
}

export function SidebarNavSectionLabel({
	children,
	collapsed = false,
}: {
	children: ReactNode;
	collapsed?: boolean;
}) {
	if (collapsed) return null;
	return (
		<div
			className="px-2 pt-1 pb-1 uppercase"
			data-layout-role="sidebar-nav-section-label"
		>
			{children}
		</div>
	);
}

export function sidebarNavItemClass({
	collapsed = false,
	nested = false,
}: {
	collapsed?: boolean;
	nested?: boolean;
} = {}) {
	return cn(
		"flex h-(--control) items-center gap-2 rounded-tag px-2 type-label text-text-2 hover:bg-hover hover:text-text-1 aria-[current=page]:bg-pressed aria-[current=page]:text-text-1",
		nested && !collapsed && "ps-(--sidebar-nested-indent)",
		collapsed &&
			"group/nav-link h-(--control) w-(--control-sm) justify-center rounded-none px-0 hover:bg-transparent aria-[current=page]:bg-transparent",
	);
}

export function SidebarNavItemContent({
	icon,
	label,
	value,
	collapsed = false,
	nested = false,
}: {
	icon: IconGlyph;
	label: string;
	value?: number;
	collapsed?: boolean;
	nested?: boolean;
}) {
	return (
		<>
			<span
				className={cn(
					"relative flex h-[22px] w-[26px] items-center justify-center",
					collapsed && "rounded-[8px]",
				)}
				data-collapsed={collapsed ? "true" : undefined}
				data-layout-role="sidebar-nav-icon-plate"
			>
				<span className="flex" data-layout-role="sidebar-nav-icon">
					<Icon icon={icon} size={collapsed ? 18 : undefined} />
				</span>
			</span>
			{collapsed ? null : (
				<span className="min-w-0 truncate" title={nested ? label : undefined}>
					{label}
				</span>
			)}
			{value !== undefined && !collapsed ? (
				<span
					className="ms-auto tabular-nums"
					data-layout-role="sidebar-nav-count"
				>
					{value}
					<span className="sr-only"> to review</span>
				</span>
			) : null}
		</>
	);
}

export function SidebarNavTooltip({
	label,
	collapsed,
	children,
}: {
	label: string;
	collapsed: boolean;
	children: ReactElement<{
		"aria-label"?: string;
		"aria-labelledby"?: string;
		children?: ReactNode;
		title?: string;
	}>;
}) {
	if (!collapsed) {
		return children;
	}
	return (
		<Tooltip
			offset="spacious"
			placement="right"
			trigger={children}
			variant="sidebar"
		>
			{label}
		</Tooltip>
	);
}
