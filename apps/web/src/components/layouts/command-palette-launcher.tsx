import { Button, IconButton } from "@tripwire/ui/button";
import { Icon, Search } from "@tripwire/ui/icon";
import { Kbd } from "@tripwire/ui/kbd";
import { UI_MOTION } from "@tripwire/ui/motion";
import { Tooltip } from "@tripwire/ui/tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	type ComponentPropsWithRef,
	lazy,
	Suspense,
	useEffect,
	useState,
} from "react";

const CommandPalette = lazy(() =>
	import("#/components/layouts/command-palette").then((m) => ({
		default: m.CommandPalette,
	})),
);

/**
 * §4 command palette — opens on ⌘K / "/", the ONE keyboard surface for the
 * app. Orgs (the switcher), repos when an org is in URL context, actions
 * (arm/disarm the current repo, jump, sign out), and navigation, all
 * fuzzy-searchable. Scope is the URL (§8) — every jump is a navigation, never
 * a server-side scope mutation.
 */
const OPEN_EVENT = "tripwire:open-command-palette";

export function openCommandPalette(): void {
	window.dispatchEvent(new Event(OPEN_EVENT));
}

function pageOwnsSlash(): boolean {
	return document.querySelector('[aria-keyshortcuts="/"]') !== null;
}

export function CommandPaletteLauncher() {
	const [open, setOpen] = useState(false);
	const [loaded, setLoaded] = useState(false);
	if (open && !loaded) {
		setLoaded(true);
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((value) => !value);
				return;
			}
			if (
				event.key === "/" &&
				!open &&
				!event.defaultPrevented &&
				!isTypingTarget(event.target) &&
				!pageOwnsSlash()
			) {
				event.preventDefault();
				setOpen(true);
			}
		};
		const onOpen = () => setOpen(true);
		window.addEventListener("keydown", onKey);
		window.addEventListener(OPEN_EVENT, onOpen);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener(OPEN_EVENT, onOpen);
		};
	}, [open]);

	return loaded ? (
		<Suspense fallback={null}>
			<CommandPalette onClose={() => setOpen(false)} open={open} />
		</Suspense>
	) : null;
}

/** True when focus is in a field, so "/" types a slash instead of opening. */
function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.isContentEditable
	);
}

interface SidebarSearchTriggerProps
	extends Omit<ComponentPropsWithRef<"button">, "children" | "className"> {}

interface RailSearchTriggerProps extends SidebarSearchTriggerProps {
	collapsed: boolean;
}

function SidebarSearchIcon() {
	return (
		<span data-layout-role="sidebar-search-icon">
			<Icon icon={Search} size={16} />
		</span>
	);
}

function SidebarSearchTrigger({
	collapsed,
	ref,
	type = "button",
	...buttonProps
}: RailSearchTriggerProps) {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : UI_MOTION.state;
	return (
		<button
			{...buttonProps}
			data-collapsed={collapsed || undefined}
			data-layout-role="sidebar-search-trigger"
			ref={ref}
			type={type}
		>
			<SidebarSearchIcon />
			<AnimatePresence initial={false} mode="popLayout">
				{collapsed ? null : (
					<motion.span
						animate={{ opacity: 1, transform: "translateX(0px)" }}
						data-layout-role="sidebar-search-label"
						exit={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						initial={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						transition={transition}
					>
						Search
					</motion.span>
				)}
			</AnimatePresence>
			<AnimatePresence initial={false} mode="popLayout">
				{collapsed ? null : (
					<motion.span
						animate={{ opacity: 1, transform: "translateX(0px)" }}
						aria-hidden
						data-layout-role="sidebar-search-shortcut"
						exit={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						initial={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						transition={transition}
					>
						Ctrl K
					</motion.span>
				)}
			</AnimatePresence>
		</button>
	);
}

export function CommandPaletteButton({
	wide = false,
	collapsed = false,
}: {
	wide?: boolean;
	collapsed?: boolean;
}) {
	if (wide || collapsed) {
		const trigger = (
			<SidebarSearchTrigger
				aria-keyshortcuts="Meta+K Control+K"
				aria-label="Search"
				collapsed={collapsed}
				onClick={openCommandPalette}
			/>
		);
		return (
			<div data-layout-role={wide ? "command-palette-wide-trigger" : undefined}>
				<Tooltip
					offset="spacious"
					open={collapsed ? undefined : false}
					trigger={trigger}
					variant="sidebar"
				>
					Search
				</Tooltip>
			</div>
		);
	}
	return (
		<>
			<div className="max-sm:hidden">
				<Button
					ariaKeyShortcuts="Meta+K Control+K"
					onAction={openCommandPalette}
					size="small"
					variant="ghost"
				>
					<Icon icon={Search} />
					Search
					<Kbd>⌘ K</Kbd>
				</Button>
			</div>
			<div className="sm:hidden">
				<IconButton
					icon={<Icon icon={Search} />}
					label="Search"
					onAction={openCommandPalette}
					size="small"
					variant="ghost"
				/>
			</div>
		</>
	);
}
