import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { OrganizationConnectionRow } from "#/components/forges/organization-connection-row";
import { Add, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { CollapsibleGroup } from "#/components/glaze/ui/collapsible";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { organizationConnectionsQueryOptions } from "#/lib/connections.query";
import { orgHomeQueryOptions } from "#/lib/org.query";

export function OrganizationConnectionsPage({ org }: { org: string }) {
	const [connecting, setConnecting] = useState(false);
	const queryClient = useQueryClient();
	const canManage = useOrgPermission(org, "connections:manage");
	const query = useQuery({
		...organizationConnectionsQueryOptions(org),
		enabled: canManage,
	});
	return (
		<>
			<SettingsHeader title="Connections">
				{canManage ? (
					<Button onClick={() => setConnecting(true)}>
						<Icon icon={Add} />
						Connect repos
					</Button>
				) : null}
			</SettingsHeader>
			{!canManage ? (
				<p className="type-body text-text-2">
					Ask an admin of this org to manage repository access.
				</p>
			) : query.isPending ? (
				<div className="flex flex-col gap-3">
					<SkeletonText className="w-32" type="label" />
					<SkeletonText className="w-20" type="body-sm" />
				</div>
			) : query.isError && query.data === undefined ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="type-body text-text-2">Couldn't load connections.</p>
					<Button
						onClick={() => {
							void query.refetch();
						}}
						variant="secondary"
					>
						Try again
					</Button>
				</div>
			) : (
				<>
					{query.isError ? (
						<p className="type-body-sm text-text-2" role="alert">
							Couldn't refresh access. The last loaded repositories are shown.
						</p>
					) : null}
					{query.data?.length ? (
						<div className="shell">
							<div className="panel p-0">
								<CollapsibleGroup aria-label="Connected forges" variant="plain">
									{query.data.map((connection) => (
										<OrganizationConnectionRow
											connection={connection}
											key={`${org}:${connection.forge}`}
											onCheckAccess={async () => {
												await query.refetch({ throwOnError: true });
												await queryClient.invalidateQueries({
													queryKey: orgHomeQueryOptions(org).queryKey,
												});
											}}
										/>
									))}
								</CollapsibleGroup>
							</div>
						</div>
					) : (
						<p className="type-body text-text-2">
							No forges connected to this org yet.
						</p>
					)}
				</>
			)}
			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org}
			/>
		</>
	);
}
