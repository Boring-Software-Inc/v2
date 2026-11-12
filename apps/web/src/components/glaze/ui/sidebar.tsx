import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type {
	ComponentPropsWithoutRef,
	ComponentPropsWithRef,
	ReactElement,
	ReactNode,
} from "react";
import { useLayoutEffect, useRef } from "react";
import { type GlazeIcon, Icon } from "#/design-system/icon";
import { cn } from "#/design-system/lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import "./sidebar.css";

export type SidebarTransitionDirection = "forward" | "back";

interface PendingSidebarSnapshot {
	direction: SidebarTransitionDirection;
	element: HTMLElement;
}

let pendingSidebarSnapshot: PendingSidebarSnapshot | null = null;

function supportsViewTransitions() {
	return typeof document.startViewTransition === "function";
}

function motionValue(name: string, fallback: number) {
	const value = getComputedStyle(document.body).getPropertyValue(name).trim();
	if (!value) return fallback;
	const amount = Number.parseFloat(value);
	if (!Number.isFinite(amount)) return fallback;
	return value.endsWith("s") && !value.endsWith("ms") ? amount * 1000 : amount;
}

function captureSidebarSnapshot(direction: SidebarTransitionDirection) {
	if (
		window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
		supportsViewTransitions()
	) {
		return;
	}
	const source = document.querySelector<HTMLElement>("[data-sidebar-swap]");
	if (!source) return;
	const bounds = source.getBoundingClientRect();
	const snapshot = source.cloneNode(true) as HTMLElement;
	snapshot.removeAttribute("data-sidebar-swap");
	snapshot.setAttribute("aria-hidden", "true");
	const frame = document.createElement("div");
	frame.dataset.sidebarSnapshot = "";
	frame.dataset.sidebarTransitionDirection = direction;
	frame.style.insetBlockStart = `${bounds.top}px`;
	frame.style.insetInlineStart = `${bounds.left}px`;
	frame.style.inlineSize = `${bounds.width}px`;
	frame.style.blockSize = `${bounds.height}px`;
	frame.append(snapshot);
	document.body.append(frame);
	pendingSidebarSnapshot?.element.remove();
	pendingSidebarSnapshot = { direction, element: frame };
}

export function prepareSidebarTransition(
	direction: SidebarTransitionDirection,
) {
	document.documentElement.dataset.sidebarTransitionDirection = direction;
	captureSidebarSnapshot(direction);
}

export async function runSidebarTransition(
	direction: SidebarTransitionDirection,
	update: () => Promise<void>,
) {
	prepareSidebarTransition(direction);
	if (
		window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
		!supportsViewTransitions()
	) {
		await update();
		return;
	}
	const transition = document.startViewTransition(update);
	await transition.finished;
}

export function SidebarNav({
	className,
	...props
}: ComponentPropsWithRef<"nav">) {
	return (
		<nav
			className={cn("flex min-w-0 flex-col gap-px", className)}
			{...props}
		/>
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
		<div className="px-2 pt-1 pb-1 type-label-sm text-text-3 uppercase">
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
	icon: GlazeIcon;
	label: string;
	value?: number;
	collapsed?: boolean;
	nested?: boolean;
}) {
	return (
		<>
			{collapsed ? (
				<span className="flex h-[22px] w-[26px] items-center justify-center rounded-[8px] group-hover/nav-link:bg-hover group-aria-[current=page]/nav-link:bg-pressed">
					<Icon className="size-[18px]!" icon={icon} size={16} />
				</span>
			) : (
				<Icon icon={icon} />
			)}
			{collapsed ? null : (
				<span className="min-w-0 truncate" title={nested ? label : undefined}>
					{label}
				</span>
			)}
			{value !== undefined && !collapsed ? (
				<span className="ms-auto text-text-3 tabular-nums">
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
	children: ReactElement;
}) {
	if (!collapsed) {
		return children;
	}
	return (
		<Tooltip>
			<TooltipTrigger render={children} />
			<TooltipContent side="right" sideOffset={16} variant="sidebar">
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export function SidebarSwap({
	activeKey,
	direction,
	children,
}: {
	activeKey: string;
	direction: "forward" | "back";
	children: ReactNode;
}) {
	const reduceMotion = useReducedMotion();
	const outgoing =
		direction === "forward"
			? "var(--space-6)"
			: "calc(var(--space-6) * -1)";
	const incoming =
		direction === "forward"
			? "calc(var(--space-6) * -1)"
			: "var(--space-6)";
	const swapRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const pending = pendingSidebarSnapshot;
		const incoming = swapRef.current;
		if (!(pending && incoming)) return;
		pendingSidebarSnapshot = null;
		const duration = motionValue("--dur-slide", 200);
		incoming.dataset.sidebarEntering = pending.direction;
		window.setTimeout(() => {
			pending.element.remove();
			delete incoming.dataset.sidebarEntering;
		}, duration);
	}, []);
	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			data-sidebar-swap=""
			ref={swapRef}
		>
			<AnimatePresence initial={false} mode="popLayout">
				<motion.div
					animate={{ x: 0 }}
					className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
					exit={{ x: reduceMotion ? 0 : outgoing }}
					initial={{ x: reduceMotion ? 0 : incoming }}
					key={activeKey}
					transition={
						reduceMotion
							? { duration: 0 }
							: { duration: 0.2, ease: [0.16, 1, 0.3, 1] }
					}
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
