import { useQuery } from "@tanstack/react-query";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { devWhoamiQueryOptions } from "#/lib/dev/dev.query";

interface DevIdentityProps {
	busy: string | null;
	current: string | null;
	onLogout: () => void;
	onReset: () => void;
}

export function DevIdentity({
	busy,
	current,
	onLogout,
	onReset,
}: DevIdentityProps) {
	const { data: whoami } = useQuery(devWhoamiQueryOptions());
	return (
		<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
			<div className="flex min-w-0 flex-col gap-1">
				{whoami ? (
					<p className="truncate type-label">
						{whoami.signedIn ? whoami.email : "Signed out"}
					</p>
				) : null}
				{whoami?.signedIn && whoami.orgs.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{whoami.orgs.map((org) => (
							<Badge key={org.slug} variant="outline">
								{org.name}, {org.role}
							</Badge>
						))}
					</div>
				) : null}
				{current ? (
					<p className="type-caption text-text-2">
						Current <span className="text-text-1">{current}</span>
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 gap-2">
				{whoami?.signedIn === false ? null : (
					<Button
						disabled={busy !== null && busy !== "logout"}
						onClick={onLogout}
						pending={busy === "logout"}
						size="sm"
						variant="secondary"
					>
						Sign out
					</Button>
				)}
				<Button
					disabled={busy !== null && busy !== "reset"}
					onClick={onReset}
					pending={busy === "reset"}
					size="sm"
					variant="secondary"
				>
					Reset dev data
				</Button>
			</div>
		</div>
	);
}
