import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tripwire/ui/button";
import { Add, Icon } from "@tripwire/ui/icon";
import { SkeletonText } from "@tripwire/ui/skeleton";
import { useState } from "react";
import {
	EmptyState,
	EmptyStateCode,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateRetry,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { OrganizationConnectionRow } from "#/components/forges/organization-connection-row";
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
	const errorDetail =
		import.meta.env.DEV && query.error instanceof Error
			? query.error.message
			: null;
	return (
		<>
			<SettingsHeader title="Connections">
				{canManage ? (
					<Button onAction={() => setConnecting(true)} variant="primary">
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
					<span data-skeleton-line="" aria-hidden className="w-32">
						<SkeletonText type="label" />
					</span>
					<span data-skeleton-line="" aria-hidden className="w-20">
						<SkeletonText type="body-sm" />
					</span>
				</div>
			) : query.isError && query.data === undefined ? (
				<EmptyState reason="error" size="sm" variant="plain">
					<EmptyStateHeader>
						<EmptyStateTitle>Couldn't load connections</EmptyStateTitle>
						<EmptyStateDescription>
							Tripwire couldn't read this org's saved forge connections.
						</EmptyStateDescription>
						{errorDetail ? (
							<EmptyStateCode>{errorDetail}</EmptyStateCode>
						) : null}
					</EmptyStateHeader>
					<EmptyStateContent>
						<EmptyStateRetry
							onRetry={async () => {
								await query.refetch({ throwOnError: true });
							}}
						>
							Try again
						</EmptyStateRetry>
					</EmptyStateContent>
				</EmptyState>
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
								<fieldset>
									<legend className="sr-only">Connected forges</legend>
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
								</fieldset>
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
