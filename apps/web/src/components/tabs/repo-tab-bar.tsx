import { Cancel01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRepoTabTarget } from "#/components/tabs/repo-tab-target";
import { useRepoTabs } from "#/components/tabs/repo-tabs-provider";
import type { RepoTab } from "#/components/tabs/repo-tabs-state";
import { cn } from "#/lib/utils";

/**
 * The strip of repos you've opened. Rendered in the topbar on desktop and in
 * the mobile footer, so the app nav can live inside the page shell on both.
 *
 * It's a recents list, not a scope control: every tab is a URL, so clicking one
 * is an ordinary navigation and the URL still owns the org (§8). Tabs cross
 * orgs freely — each carries its own.
 */
export function RepoTabBar({ className }: { className?: string }) {
	const { hydrated, tabs, closeTab } = useRepoTabs();
	const target = useRepoTabTarget();
	const navigate = useNavigate();

	// Nothing to show before hydration — rendering an empty strip first would
	// pop a row of tabs in one frame later.
	if (!hydrated || tabs.length === 0) {
		return null;
	}

	function handleClose(tab: RepoTab) {
		closeTab(tab.id);
		if (tab.id !== target?.id) {
			return;
		}
		// Closing the page you're on has to move you: the neighbour on the right,
		// falling back to the left, and to org home when that was the last tab.
		const index = tabs.findIndex((candidate) => candidate.id === tab.id);
		const neighbour = tabs[index + 1] ?? tabs[index - 1];
		navigate(
			neighbour
				? { to: neighbour.path }
				: { to: "/$org/home", params: { org: tab.org } },
		);
	}

	return (
		<nav
			aria-label="Open repos"
			className={cn(
				"flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
				className,
			)}
		>
			{tabs.map((tab) => (
				<RepoTabItem
					active={tab.id === target?.id}
					key={tab.id}
					onClose={() => handleClose(tab)}
					tab={tab}
				/>
			))}
		</nav>
	);
}

function RepoTabItem({
	tab,
	active,
	onClose,
}: {
	tab: RepoTab;
	active: boolean;
	onClose: () => void;
}) {
	return (
		<div
			className={cn(
				"group/tab flex h-7 shrink-0 items-center rounded-lg text-[13px] transition-colors",
				active
					? "bg-surface-0 text-foreground"
					: "text-muted-foreground hover:bg-surface-0 hover:text-foreground",
			)}
		>
			<Link
				className="flex h-full min-w-0 items-center gap-2 ps-3 pe-1.5"
				title={tab.id}
				to={tab.path}
			>
				<HugeiconsIcon
					className="shrink-0"
					icon={Folder01Icon}
					size={14}
					strokeWidth={2}
				/>
				<span className="min-w-0 max-w-[12rem] truncate font-medium">
					{tab.id}
				</span>
			</Link>
			{/* Held open on the active tab so the page you're on can always be
			    dismissed without hunting for a hover target. */}
			<button
				aria-label={`Close ${tab.id}`}
				className={cn(
					"me-1.5 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-surface-2 hover:text-foreground",
					active
						? "opacity-100"
						: "opacity-0 focus-visible:opacity-100 group-hover/tab:opacity-100",
				)}
				onClick={onClose}
				type="button"
			>
				<HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2.4} />
			</button>
		</div>
	);
}
