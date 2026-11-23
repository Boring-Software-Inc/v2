import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@tripwire/ui/button";
import { Close, Folder, Icon } from "@tripwire/ui/icon";
import { useRepoTabTarget } from "#/components/tabs/repo-tab-target";
import { useRepoTabs } from "#/components/tabs/repo-tabs-provider";
import {
	compactRepoTabLabel,
	type RepoTab,
} from "#/components/tabs/repo-tabs-state";
import { duplicateRepoNames, qualifiedRepoLabel } from "#/lib/repo-label";
import { parseRepoRouteKey } from "#/lib/repo-route";
import { cn } from "#/lib/utils";

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
	const identities = tabs.flatMap((tab) => {
		const identity = parseRepoRouteKey(tab.repo);
		return identity ? [{ ...identity, org: tab.org }] : [];
	});
	const duplicateNames = duplicateRepoNames(
		identities.map((identity) => ({
			name: `${identity.org}/${identity.name}`,
		})),
	);

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
			{tabs.map((tab) => {
				const identity = parseRepoRouteKey(tab.repo);
				const label =
					identity && duplicateNames.has(`${tab.org}/${identity.name}`)
						? `${tab.org}/${qualifiedRepoLabel(identity)}`
						: tab.label;
				return (
					<RepoTabItem
						active={tab.id === target?.id}
						key={tab.id}
						label={label}
						onClose={() => handleClose(tab)}
						orientation={orientation}
						tab={tab}
					/>
				);
			})}
		</nav>
	);
}

function RepoTabItem({
	tab,
	label,
	active,
	onClose,
	orientation,
}: {
	tab: RepoTab;
	label: string;
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
				title={label}
				to={tab.path}
			>
				<Icon icon={Folder} />
				<span className="min-w-0 max-w-48 truncate">
					{column ? compactRepoTabLabel(label) : label}
				</span>
			</Link>
			<span
				className={cn(
					active
						? "opacity-100"
						: "opacity-0 focus-visible:opacity-100 group-hover/tab:opacity-100 pointer-coarse:opacity-100",
				)}
			>
				<Button
					ariaLabel={`Close ${label} tab`}
					onAction={onClose}
					size="small"
					variant="ghost"
				>
					<Icon icon={Close} />
				</Button>
			</span>
		</div>
	);
}
