import { lazy, Suspense, useEffect, useState } from "react";
import { ChevronSort, GithubMark, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useActiveScope } from "#/hooks/use-active-scope";
import { cn } from "#/lib/glaze/utils";

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
export function RepoSwitcher({
	appearance = "path",
}: {
	appearance?: "path" | "rail";
}) {
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

	const avatar = activeOrg ? (
		<OrgAvatar eyes hue={activeOrg.avatarHue} name={activeOrg.name} size="sm" />
	) : (
		<Icon icon={GithubMark} />
	);

	return (
		<>
			<Button
				aria-label={
					activeOrg ? `${label}: switch org or repo` : "Switch org or repo"
				}
				className={
					appearance === "rail"
						? "w-full min-w-0 justify-start"
						: "min-w-0 max-w-full shrink"
				}
				onClick={() => setOpen(true)}
				variant={appearance === "rail" ? "secondary" : "ghost"}
			>
				<span className="-ms-1 flex size-5 shrink-0 items-center justify-center">
					{avatar}
				</span>
				{appearance === "path" && activeOrg && activeRepo ? (
					<>
						<span className="min-w-0 truncate text-text-2">
							{activeOrg.slug}
						</span>
						<span aria-hidden className="text-text-3">
							/
						</span>
					</>
				) : null}
				<span className="min-w-0 truncate">
					{activeRepo ?? activeOrg?.slug ?? "Switch org"}
				</span>
				<Icon
					className={cn(
						"shrink-0 text-text-3",
						appearance === "rail" && "ms-auto",
					)}
					icon={ChevronSort}
				/>
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
