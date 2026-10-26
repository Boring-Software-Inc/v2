import { Link } from "@tanstack/react-router";
import type { HomeDigest } from "@tripwire/contracts";
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
}

export function DigestActivityButton({
	org,
	repos,
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
					<Link params={{ org, repo: repo.name }} to="/$org/$repo/activity" />
				}
				size="sm"
				variant="secondary"
			>
				Open activity
			</Button>
		);
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
				Open activity
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{repos.map((repo) => (
					<DropdownMenuLinkItem
						key={repo.id}
						render={
							<Link
								params={{ org, repo: repo.name }}
								to="/$org/$repo/activity"
							/>
						}
					>
						Open {repo.name} activity
					</DropdownMenuLinkItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
