import { Link } from "@tanstack/react-router";
import type {
	DigestHistoryInput,
	DigestHistoryWindow,
	HomeDigest,
} from "@tripwire/contracts";
import type { ReactNode } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLinkItem,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";

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
	const repo = repos[0];
	if (!repo) {
		return null;
	}
	if (repos.length === 1) {
		return (
			<Button
				nativeButton={false}
				render={
					<Link
						params={{ org, repo: repo.name }}
						search={{ verdict: "all", ...period }}
						to="/$org/$repo/activity"
					/>
				}
				size="sm"
				variant="secondary"
			>
				Open run history
			</Button>
		);
	}
	return (
		<DigestActivityMenu org={org} period={period} repos={repos}>
			<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
				Open run history
			</DropdownMenuTrigger>
		</DigestActivityMenu>
	);
}

interface DigestActivityMenuProps extends DigestActivityButtonProps {
	children: ReactNode;
	verdict?: DigestHistoryInput["verdict"];
}

export function DigestActivityMenu({
	org,
	repos,
	children,
	verdict = "all",
	period,
}: DigestActivityMenuProps) {
	return (
		<DropdownMenu>
			{children}
			<DropdownMenuContent align="end">
				{repos.map((repo) => (
					<DropdownMenuLinkItem
						key={repo.id}
						render={
							<Link
								params={{ org, repo: repo.name }}
								search={{ verdict, ...period }}
								to="/$org/$repo/activity"
							/>
						}
					>
						Open {repo.name} run history
					</DropdownMenuLinkItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
