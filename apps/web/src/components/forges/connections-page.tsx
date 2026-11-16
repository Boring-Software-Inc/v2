import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FORGE_BY_ID, type ForgeConnection } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Add, Icon } from "@tripwire/ui/icon";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@tripwire/ui/item";
import { Skeleton, SkeletonSwap, SkeletonText } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { useState } from "react";
import {
	EmptyState,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { OrganizationConnectionsPage } from "#/components/forges/organization-connections-page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { disconnectForge } from "#/lib/connections.functions";
import { connectionsQueryOptions } from "#/lib/connections.query";
import { reconnectForge } from "#/lib/forge-connect";

/** Expired, or close enough that the next call will have to refresh. */
function tokenExpired(connection: ForgeConnection): boolean {
	if (!connection.accessTokenExpiresAt) {
		return false;
	}
	return Date.parse(connection.accessTokenExpiresAt) <= Date.now();
}

function ConnectionRow({
	connection,
	login,
}: {
	connection: ForgeConnection;
	login: string | null;
}) {
	const queryClient = useQueryClient();
	const label = FORGE_BY_ID[connection.forge]?.label ?? connection.forge;
	const needsReauth = tokenExpired(connection) && !connection.canRefresh;
	const confirmText = connection.forge === "github" && login ? login : label;

	const disconnect = useMutation({
		mutationFn: () =>
			disconnectForge({
				data: { forge: connection.forge, accountId: connection.accountId },
			}),
		onSuccess: (result) => {
			notify.show(
				{
					title:
						result.removedRepos === 0
							? `${label} disconnected`
							: `${label} disconnected. Tripwire stopped watching ${result.removedRepos} ${result.removedRepos === 1 ? "repo" : "repos"}.`,
				},
				"success",
			);
			void queryClient.invalidateQueries();
		},
	});

	return (
		<Item>
			<ItemMedia variant="icon">
				<ForgeMark className="size-(--icon)" forge={connection.forge} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span>{label}</span>
				</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>
							{connection.repoCount === 0
								? "No repos"
								: `${connection.repoCount} ${connection.repoCount === 1 ? "repo" : "repos"}`}
						</span>
						{connection.unclaimedCount > 0 ? (
							<span>{connection.unclaimedCount} not in an org yet</span>
						) : null}
						{needsReauth ? (
							<span>Access expired, reconnect to keep watching</span>
						) : null}
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{needsReauth ? (
					<Button
						onAction={() => {
							void reconnectForge(connection.forge).then((message) => {
								if (message) {
									notify.show({ title: message }, "error");
								}
							});
						}}
						size="small"
						variant="secondary"
					>
						Reconnect {label}
					</Button>
				) : null}
				<Button
					ariaLabel={`Disconnect ${label}`}
					confirmation={{
						confirmLabel: "Disconnect",
						description:
							connection.repoCount > 0
								? `Disconnect ${confirmText}. Tripwire stops watching ${connection.repoCount} ${connection.repoCount === 1 ? "repo" : "repos"}.`
								: `Disconnect ${confirmText} from Tripwire.`,
						title: `Disconnect ${label}?`,
					}}
					onAction={() => disconnect.mutateAsync()}
					pending={disconnect.isPending}
					pendingLabel="Disconnecting"
					size="small"
					variant="destructive"
				>
					Disconnect
				</Button>
			</ItemActions>
		</Item>
	);
}

const ROW_SLOTS = ["a", "b"] as const;

function ConnectionRowsSkeleton() {
	return (
		<ItemGroup variant="plain" aria-hidden>
			{ROW_SLOTS.map((slot) => (
				<Item key={slot}>
					<ItemMedia variant="icon">
						<span data-skeleton-box="" aria-hidden className="size-(--icon)">
							<Skeleton fill />
						</span>
					</ItemMedia>
					<ItemContent>
						<span data-skeleton-line="" aria-hidden className="w-20">
							<SkeletonText type="label" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-32">
							<SkeletonText type="body-sm" />
						</span>
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

export function ConnectionsPage({ org }: { org: string | null }) {
	return org ? (
		<OrganizationConnectionsPage org={org} />
	) : (
		<AccountConnectionsPage />
	);
}

function AccountConnectionsPage() {
	const [connecting, setConnecting] = useState(false);
	const { data: connections, isLoading } = useQuery(connectionsQueryOptions());
	const { data: user } = useQuery(currentUserQueryOptions());

	return (
		<>
			<SettingsHeader title="Connections">
				<Button onAction={() => setConnecting(true)} variant="primary">
					<Icon icon={Add} />
					Connect repos
				</Button>
			</SettingsHeader>

			<SkeletonSwap
				fallback={<ConnectionRowsSkeleton />}
				label="Loading connections"
				loading={isLoading}
			>
				{connections?.length ? (
					<div className="shell">
						<ItemGroup aria-label="Connections">
							{connections.map((connection) => (
								<ConnectionRow
									connection={connection}
									key={`${connection.forge}:${connection.accountId}`}
									login={user?.forgeLogin ?? null}
								/>
							))}
						</ItemGroup>
					</div>
				) : (
					<EmptyState
						art={<MascotArt mood="forges-empty" size="compact" />}
						size="sm"
						variant="plain"
					>
						<EmptyStateHeader>
							<EmptyStateTitle>No forges connected yet</EmptyStateTitle>
						</EmptyStateHeader>
					</EmptyState>
				)}
			</SkeletonSwap>

			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={null}
			/>
		</>
	);
}
