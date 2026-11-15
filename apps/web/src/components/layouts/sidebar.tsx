import { UI_MOTION } from "@tripwire/ui/motion";
import { Tooltip } from "@tripwire/ui/tooltip";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	useReducedMotion,
} from "motion/react";
import type {
	ComponentPropsWithoutRef,
	ComponentPropsWithRef,
	ReactElement,
	ReactNode,
} from "react";
import { cloneElement, useLayoutEffect, useRef } from "react";
import "./sidebar.css";

function cn(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(" ");
}

export type SidebarTransitionDirection = "forward" | "back";

interface PendingSidebarSnapshot {
	direction: SidebarTransitionDirection;
	element: HTMLElement;
}

let pendingSidebarSnapshot: PendingSidebarSnapshot | null = null;

function supportsViewTransitions() {
	return document.startViewTransition instanceof Function;
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
	return <div data-layout-role="sidebar-section-label">{children}</div>;
}

export function sidebarNavItemClass({
	collapsed = false,
	nested = false,
}: {
	collapsed?: boolean;
	nested?: boolean;
} = {}) {
	return cn(
		"relative flex h-(--control) items-center gap-2 rounded-tag px-2 sidebar-nav-link",
		nested && !collapsed && "ps-(--sidebar-nested-indent)",
		collapsed &&
			"group/nav-link h-(--control) w-(--control-sm) justify-center rounded-none px-0",
	);
}

export function SidebarNavItemContent({
	icon,
	label,
	value,
	collapsed = false,
	nested = false,
}: {
	icon: ReactNode;
	label: string;
	value?: number;
	collapsed?: boolean;
	nested?: boolean;
}) {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : UI_MOTION.position;
	const exitTransition = reduceMotion ? { duration: 0 } : UI_MOTION.state;
	return (
		<MotionConfig transition={transition}>
			<motion.span
				data-collapsed={collapsed || undefined}
				data-layout-role="sidebar-nav-icon-plate"
				layout="position"
			>
				<span data-layout-role="sidebar-nav-icon">{icon}</span>
			</motion.span>
			<AnimatePresence initial={false} mode="popLayout">
				{collapsed ? null : (
					<motion.span
						animate={{ opacity: 1, transform: "translateX(0px)" }}
						className="min-w-0 truncate"
						data-layout-role="sidebar-nav-label"
						exit={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						initial={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						title={nested ? label : undefined}
						transition={exitTransition}
					>
						{label}
					</motion.span>
				)}
			</AnimatePresence>
			<AnimatePresence initial={false} mode="popLayout">
				{value !== undefined && !collapsed ? (
					<motion.span
						animate={{ opacity: 1, transform: "translateX(0px)" }}
						className="ms-auto overflow-hidden tone-content-tertiary tabular-nums"
						exit={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						initial={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						transition={exitTransition}
					>
						{value}
						<span className="sr-only"> to review</span>
					</motion.span>
				) : null}
			</AnimatePresence>
		</MotionConfig>
	);
}

export function SidebarNavTooltip({
	label,
	collapsed,
	children,
}: {
	label: string;
	collapsed: boolean;
	children: ReactElement<Pick<ComponentPropsWithoutRef<"a">, "aria-label">>;
}) {
	if (!collapsed) {
		return children;
	}
	return (
		<Tooltip
			offset="spacious"
			placement="right"
			trigger={cloneElement(children, { "aria-label": label })}
			variant="sidebar"
		>
			{label}
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
		direction === "forward" ? "var(--space-6)" : "calc(var(--space-6) * -1)";
	const incoming =
		direction === "forward" ? "calc(var(--space-6) * -1)" : "var(--space-6)";
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
					transition={reduceMotion ? { duration: 0 } : UI_MOTION.slide}
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
