import { lazy, Suspense, useEffect, useState } from "react";
import { Icon, Search } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Kbd } from "#/components/glaze/ui/kbd";

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

export function CommandPaletteButton({ wide = false }: { wide?: boolean }) {
	if (wide) {
		return (
			<Button
				aria-keyshortcuts="Meta+K Control+K"
				className="w-full justify-start"
				onClick={openCommandPalette}
				size="sm"
				variant="ghost"
			>
				<Icon icon={Search} />
				Search
				<Kbd className="ms-auto" keys="mod+k" />
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
