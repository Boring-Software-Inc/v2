import { Link, useNavigate } from "@tanstack/react-router";
import { Close, Folder, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { useRepoTabTarget } from "#/components/tabs/repo-tab-target";
import { useRepoTabs } from "#/components/tabs/repo-tabs-provider";
import type { RepoTab } from "#/components/tabs/repo-tabs-state";
import { cn } from "#/lib/glaze/utils";

export function RepoTabBar({
	className,
	orientation = "row",
}: {
	className?: string;
	orientation?: "row" | "column";
}) {
	const { hydrated, tabs, closeTab } = useRepoTabs();
	const target = useRepoTabTarget();
	const navigate = useNavigate();

	if (!hydrated || tabs.length === 0) {
		return null;
	}

	function handleClose(tab: RepoTab) {
		closeTab(tab.id);
		if (tab.id !== target?.id) {
			return;
		}
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
				orientation === "row"
					? "flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
					: "flex min-w-0 flex-col gap-px",
				className,
			)}
		>
			{tabs.map((tab) => (
				<RepoTabItem
					active={tab.id === target?.id}
					key={tab.id}
					onClose={() => handleClose(tab)}
					orientation={orientation}
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
	orientation,
}: {
	tab: RepoTab;
	active: boolean;
	onClose: () => void;
	orientation: "row" | "column";
}) {
	const column = orientation === "column";
	return (
		<div
			className={cn(
				"group/tab flex shrink-0 items-center gap-0.5 pe-0.5 type-label",
				column ? "h-(--control) rounded-tag" : "h-(--control-sm) rounded-pill",
				active
					? "bg-pressed text-text-1"
					: "text-text-2 hover:bg-hover hover:text-text-1",
			)}
		>
			<Link
				aria-current={active ? "page" : undefined}
				className={cn(
					"flex h-full min-w-0 items-center gap-1.5",
					column ? "flex-1 rounded-tag ps-2" : "rounded-pill ps-3",
				)}
				title={tab.id}
				to={tab.path}
			>
				<Icon icon={Folder} />
				<span className="min-w-0 max-w-48 truncate">
					{column ? tab.id.split("/").at(-1) : tab.id}
				</span>
			</Link>
			<Button
				aria-label={`Close ${tab.id} tab`}
				className={cn(
					active
						? "opacity-100"
						: "opacity-0 focus-visible:opacity-100 group-hover/tab:opacity-100 pointer-coarse:opacity-100",
				)}
				onClick={onClose}
				size="icon-sm"
				variant="ghost"
			>
				<Icon icon={Close} size={12} />
			</Button>
		</div>
	);
}
