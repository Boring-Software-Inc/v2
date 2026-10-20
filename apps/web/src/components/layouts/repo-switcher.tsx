import { lazy, Suspense, useEffect, useState } from "react";
import { GithubMark, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Kbd } from "#/components/glaze/ui/kbd";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useActiveScope } from "#/hooks/use-active-scope";

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
	const [loaded, setLoaded] = useState(false);
	if (open && !loaded) {
		setLoaded(true);
	}
	const { org: activeOrg, repo: activeRepo } = useActiveScope();

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

	const label = activeOrg
		? activeRepo
			? `${activeOrg.slug}/${activeRepo}`
			: activeOrg.slug
		: "Switch org";

	return (
		<>
			<Button
				aria-label={
					activeOrg ? `${label}: switch org or repo` : "Switch org or repo"
				}
				className="min-w-0 max-w-full shrink md:max-w-64"
				onClick={() => setOpen(true)}
				variant="secondary"
			>
				<span className="-ms-1.5 flex size-5 shrink-0 items-center justify-center">
					{activeOrg ? (
						<OrgAvatar
							eyes
							hue={activeOrg.avatarHue}
							name={activeOrg.name}
							size="sm"
						/>
					) : (
						<Icon icon={GithubMark} />
					)}
				</span>
				<span className="min-w-0 truncate">{label}</span>
				<span className="-me-1.5 hidden h-5 shrink-0 items-center rounded-pill bg-field px-2 sm:inline-flex [&_[data-slot=kbd]]:h-auto [&_[data-slot=kbd]]:min-w-0 [&_[data-slot=kbd]]:border-0 [&_[data-slot=kbd]]:bg-transparent [&_[data-slot=kbd]]:p-0 [&_[data-slot=kbd-group]]:gap-0.5">
					<Kbd keys="mod+k" />
				</span>
			</Button>
			{loaded ? (
				<Suspense fallback={null}>
					<CommandPalette onClose={() => setOpen(false)} open={open} />
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
