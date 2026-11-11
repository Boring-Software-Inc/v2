import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FORGE_BY_ID, type ForgeConnection } from "@tripwire/contracts";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { OrganizationConnectionsPage } from "#/components/forges/organization-connections-page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { Add, Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "#/design-system/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/design-system/ui/item";
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/design-system/ui/skeleton";
import { toast } from "#/design-system/ui/toast";
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
			toast.success(
				result.removedRepos === 0
					? `${label} disconnected`
					: `${label} disconnected. Tripwire stopped watching ${result.removedRepos} ${result.removedRepos === 1 ? "repo" : "repos"}.`,
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
						onClick={() => {
							void reconnectForge(connection.forge).then((message) => {
								if (message) {
									toast.fail(message);
								}
							});
						}}
						size="sm"
						variant="secondary"
					>
						Reconnect {label}
					</Button>
				) : null}
				<Button
					aria-label={`Disconnect ${label}`}
					confirmation={{
						actionLabel: "Disconnect",
						confirmText,
						description:
							connection.repoCount > 0
								? `Tripwire stops watching ${connection.repoCount} ${connection.repoCount === 1 ? "repo" : "repos"}.`
								: undefined,
						pendingLabel: "Disconnecting",
						title: `Disconnect ${label}?`,
					}}
					onAction={() => disconnect.mutateAsync()}
					size="sm"
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
						<Skeleton className="size-(--icon)" />
					</ItemMedia>
					<ItemContent>
						<SkeletonText className="w-20" type="label" />
						<SkeletonText className="w-32" type="body-sm" />
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
				<Button onClick={() => setConnecting(true)}>
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
					<Empty
						art={<MascotArt mood="forges-empty" size="compact" />}
						size="sm"
						variant="plain"
					>
						<EmptyHeader>
							<EmptyTitle>No forges connected yet</EmptyTitle>
						</EmptyHeader>
					</Empty>
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
