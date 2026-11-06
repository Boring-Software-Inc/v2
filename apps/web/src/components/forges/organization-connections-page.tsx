import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { OrganizationConnectionRow } from "#/components/forges/organization-connection-row";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { Add, Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { CollapsibleGroup } from "#/design-system/ui/collapsible";
import {
	Empty,
	EmptyCode,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import { SkeletonText } from "#/design-system/ui/skeleton";
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
	const errorDetail =
		import.meta.env.DEV && query.error instanceof Error
			? query.error.message
			: null;
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
				<Empty reason="error" size="sm" variant="plain">
					<EmptyHeader>
						<EmptyTitle>Couldn't load connections</EmptyTitle>
						<EmptyDescription>
							Tripwire couldn't read this org's saved forge connections.
						</EmptyDescription>
						{errorDetail ? <EmptyCode>{errorDetail}</EmptyCode> : null}
					</EmptyHeader>
					<EmptyContent>
						<EmptyRetry
							onRetry={async () => {
								await query.refetch({ throwOnError: true });
							}}
						>
							Try again
						</EmptyRetry>
					</EmptyContent>
				</Empty>
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
											org={org}
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
