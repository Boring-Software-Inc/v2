import { lazy, Suspense, useEffect, useState } from "react";
import { Icon, Search } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { Kbd } from "#/design-system/ui/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";

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

export function CommandPaletteButton({
	wide = false,
	collapsed = false,
}: {
	wide?: boolean;
	collapsed?: boolean;
}) {
	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-keyshortcuts="Meta+K Control+K"
							aria-label="Search"
							className="gap-0"
							onClick={openCommandPalette}
							size="icon"
							variant="ghost"
						>
							<span className="flex h-[22px] w-[26px] items-center justify-center">
								<Icon className="size-[18px]!" icon={Search} size={16} />
							</span>
						</Button>
					}
				/>
				<TooltipContent side="right" sideOffset={16} variant="sidebar">
					Search
				</TooltipContent>
			</Tooltip>
		);
	}
	if (wide) {
		return (
			<Button
				aria-keyshortcuts="Meta+K Control+K"
				className="mx-1 h-7 w-auto justify-start gap-1.5 rounded-[8px]! bg-[#FFFFFF30] px-1 text-[13px] text-[#A6A6A6] leading-5! hover:bg-[#FFFFFF30] hover:text-[#A6A6A6]"
				onClick={openCommandPalette}
				style={{
					boxShadow:
						"inset 0 0 0 1px #FFFFFF05, inset 0 1px 1px #FFFFFF0F, inset 0 0 12px 1px #FFFFFF0F, 0 1px 2px #0000001A, 0 0 0 1px #0000001A",
				}}
				variant="ghost"
			>
				<span className="flex size-[18px] items-center justify-center">
					<Icon className="size-3.5!" icon={Search} size={14} />
				</span>
				Search
				<span aria-hidden className="ms-auto me-1">
					Ctrl K
				</span>
			</Button>
		);
	}
	return (
		<>
			<Button
				aria-keyshortcuts="Meta+K Control+K"
				className="max-sm:hidden"
				onClick={openCommandPalette}
				size="sm"
				variant="ghost"
			>
				<Icon icon={Search} />
				Search
				<Kbd keys="mod+k" />
			</Button>
			<Button
				aria-keyshortcuts="Meta+K Control+K"
				aria-label="Search"
				className="sm:hidden"
				onClick={openCommandPalette}
				size="icon-sm"
				variant="ghost"
			>
				<Icon icon={Search} />
			</Button>
		</>
	);
}
