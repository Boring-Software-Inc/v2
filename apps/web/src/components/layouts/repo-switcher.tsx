import { useParams } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { GithubIcon } from "#/components/icons/github";
import { OrgAvatar } from "#/components/organizations/org-avatar";

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
export function RepoSwitcher() {
	const [open, setOpen] = useState(false);
	const params = useParams({ strict: false });

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((value) => !value);
				return;
			}
			// "/" is a global open, but not while the user is typing somewhere.
			if (event.key === "/" && !open && !isTypingTarget(event.target)) {
				event.preventDefault();
				setOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	const label = params.repo
		? `${params.org}/${params.repo}`
		: (params.org ?? "switch org");

	return (
		<>
			<button
				className="flex h-8 min-w-0 max-w-[240px] items-center gap-2 rounded-md bg-surface-1 px-2.5 text-[13px] transition-colors hover:bg-surface-2"
				onClick={() => setOpen(true)}
				type="button"
			>
				{params.org ? (
					<OrgAvatar className="shrink-0" name={params.org} size={14} />
				) : (
					<GithubIcon className="size-3.5 shrink-0 text-muted-foreground" />
				)}
				<span className="min-w-0 truncate font-medium">{label}</span>
				<kbd className="ml-auto hidden shrink-0 rounded bg-background px-1 font-mono text-[10px] text-muted-foreground sm:block">
					⌘K
				</kbd>
			</button>
			{open ? (
				<Suspense fallback={null}>
					<CommandPalette onClose={() => setOpen(false)} />
				</Suspense>
			) : null}
		</>
	);
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
