import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FORGE_BY_ID } from "@tripwire/contracts";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { Add, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Dialog,
	DialogAction,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	disconnectForge,
	type ForgeConnection,
} from "#/lib/connections.functions";
import { connectionsQueryOptions } from "#/lib/connections.query";
import { reconnectForge } from "#/lib/forge-connect";

/** Expired, or close enough that the next call will have to refresh. */
function tokenExpired(connection: ForgeConnection): boolean {
	if (!connection.accessTokenExpiresAt) {
		return false;
	}
	return Date.parse(connection.accessTokenExpiresAt) <= Date.now();
}

function ConnectionRow({ connection }: { connection: ForgeConnection }) {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const label = FORGE_BY_ID[connection.forge]?.label ?? connection.forge;
	// Expired but refreshable is not worth showing — the next call fixes it
	// silently. Only a dead grant needs the user.
	const needsReauth = tokenExpired(connection) && !connection.canRefresh;

	const disconnect = useMutation({
		mutationFn: () =>
			disconnectForge({
				data: { forge: connection.forge, accountId: connection.accountId },
			}),
		onSuccess: (result) => {
			toast.success(
				result.removedRepos === 0
					? `${label} disconnected`
					: `${label} disconnected. ${result.removedRepos} ${result.removedRepos === 1 ? "repo" : "repos"} no longer watched.`,
			);
			void queryClient.invalidateQueries();
		},
		onError: (error) => {
			toast.fail(
				error instanceof Error ? error.message : `Couldn't disconnect ${label}`,
			);
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
					{connection.repoCount === 0
						? "No repos"
						: `${connection.repoCount} ${connection.repoCount === 1 ? "repo" : "repos"}`}
					{connection.unclaimedCount > 0
						? ` · ${connection.unclaimedCount} unclaimed`
						: ""}
					{needsReauth ? " · session expired" : ""}
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
						Reconnect
					</Button>
				) : null}
				<Button
					aria-label={`Disconnect ${label}`}
					onClick={() => setConfirming(true)}
					size="sm"
					variant="ghost"
				>
					Disconnect
				</Button>
			</ItemActions>
			<Dialog onOpenChange={setConfirming} open={confirming} role="alertdialog">
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Disconnect {label}?</DialogTitle>
						<DialogDescription>
							Tripwire stops watching every repo that arrived through it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose>Cancel</DialogClose>
						<DialogAction
							onAction={() => disconnect.mutateAsync().catch(() => undefined)}
							pendingLabel="Disconnecting"
							variant="destructive"
						>
							Disconnect
						</DialogAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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

/**
 * Connections — the forges this account is linked to, what each one brings in,
 * and the door to add or remove one. Repo counts and token health are joined in
 * so a dead grant is visible HERE rather than discovered when an import fails.
 */
export function ConnectionsPage({ org }: { org: string | null }) {
	const [connecting, setConnecting] = useState(false);
	const { data: connections, isLoading } = useQuery(connectionsQueryOptions());

	return (
		<section
			aria-labelledby="connections-heading"
			className="flex flex-col gap-3"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<h3 className="type-heading-sm" id="connections-heading">
						Connections
					</h3>
					<p className="type-body-sm text-text-2">
						The forges this account is linked to. Disconnecting stops Tripwire
						watching everything that arrived through it.
					</p>
				</div>
				<Button
					onClick={() => setConnecting(true)}
					size="sm"
					variant="secondary"
				>
					<Icon icon={Add} />
					Connect
				</Button>
			</div>

			<SkeletonSwap
				fallback={<ConnectionRowsSkeleton />}
				label="Loading connections"
				loading={isLoading}
			>
				{connections?.length ? (
					<ItemGroup variant="plain" aria-label="Connections">
						{connections.map((connection) => (
							<ConnectionRow
								connection={connection}
								key={`${connection.forge}:${connection.accountId}`}
							/>
						))}
					</ItemGroup>
				) : (
					<Empty
						art={<MascotArt mood="forges-empty" size="compact" />}
						size="sm"
						variant="plain"
					>
						<EmptyHeader>
							<EmptyTitle>No forges connected yet</EmptyTitle>
							<EmptyDescription>
								Connect a forge to bring its repos in.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								onClick={() => setConnecting(true)}
								size="sm"
								variant="secondary"
							>
								Connect forge
							</Button>
						</EmptyContent>
					</Empty>
				)}
			</SkeletonSwap>

			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org}
			/>
		</section>
	);
}
