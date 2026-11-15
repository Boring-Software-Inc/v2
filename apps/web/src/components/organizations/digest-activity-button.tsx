import { useNavigate } from "@tanstack/react-router";
import type {
	DigestHistoryInput,
	DigestHistoryWindow,
	HomeDigest,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Menu, type MenuProps } from "@tripwire/ui/menu";

interface DigestActivityButtonProps {
	org: string;
	repos: HomeDigest["repos"];
	period: DigestHistoryWindow;
}

export function DigestActivityButton({
	org,
	repos,
	period,
}: DigestActivityButtonProps) {
	const navigate = useNavigate();
	const repo = repos[0];
	if (!repo) {
		return null;
	}
	if (repos.length === 1) {
		return (
			<Button
				href={`/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}/activity`}
				onNavigate={() =>
					void navigate({
						params: { org, repo: repo.name },
						search: { verdict: "all", ...period },
						to: "/$org/$repo/activity",
					})
				}
				size="small"
				variant="secondary"
			>
				Open run history
			</Button>
		);
	}
	return (
		<DigestActivityMenu org={org} period={period} repos={repos}>
			<Button size="small" variant="secondary">
				Open run history
			</Button>
		</DigestActivityMenu>
	);
}

interface DigestActivityMenuProps extends DigestActivityButtonProps {
	children: MenuProps["trigger"];
	verdict?: DigestHistoryInput["verdict"];
}

export function DigestActivityMenu({
	org,
	repos,
	children,
	verdict = "all",
	period,
}: DigestActivityMenuProps) {
	const navigate = useNavigate();
	return (
		<Menu
			align="end"
			ariaLabel="Open run history"
			items={repos.map((repo) => ({
				label: `Open ${repo.name} run history`,
				onAction: () =>
					void navigate({
						params: { org, repo: repo.name },
						search: { verdict, ...period },
						to: "/$org/$repo/activity",
					}),
				type: "action" as const,
				value: repo.id,
			}))}
			trigger={children}
		/>
	);
}
