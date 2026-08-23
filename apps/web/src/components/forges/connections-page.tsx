import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FORGE_BY_ID } from "@tripwire/contracts";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/toast";
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
					: `${label} disconnected — ${result.removedRepos} ${result.removedRepos === 1 ? "repo" : "repos"} no longer watched`,
			);
			setConfirming(false);
			void queryClient.invalidateQueries();
		},
		onError: (error) => {
			setConfirming(false);
			toast.error(
				error instanceof Error ? error.message : `couldn't disconnect ${label}`,
			);
		},
	});

	return (
		<div className="flex items-center gap-3 rounded-lg bg-surface-0 px-3 py-2.5">
			<ForgeMark
				className="size-4 shrink-0 text-muted-foreground"
				forge={connection.forge}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-[13px] text-foreground">
					{label}
				</span>
				<span className="text-[12px] text-muted-foreground leading-5">
					{connection.repoCount === 0
						? "no repos"
						: `${connection.repoCount} ${connection.repoCount === 1 ? "repo" : "repos"}`}
					{connection.unclaimedCount > 0
						? ` · ${connection.unclaimedCount} unclaimed`
						: ""}
					{needsReauth ? " · session expired" : ""}
				</span>
			</div>
			{needsReauth ? (
				<Button
					onClick={() => {
						void reconnectForge(connection.forge).then((message) => {
							if (message) {
								toast.error(message);
							}
						});
					}}
					size="xs"
					variant="outline"
				>
					reconnect
				</Button>
			) : null}
			{confirming ? (
				<div className="flex shrink-0 items-center gap-1">
					<Button
						disabled={disconnect.isPending}
						iconLeft={disconnect.isPending ? <Spinner size={12} /> : undefined}
						onClick={() => disconnect.mutate()}
						size="xs"
						variant="destructive"
					>
						disconnect
					</Button>
					<Button
						onClick={() => setConfirming(false)}
						size="xs"
						variant="ghost"
					>
						cancel
					</Button>
				</div>
			) : (
				<Button onClick={() => setConfirming(true)} size="xs" variant="ghost">
					disconnect
				</Button>
			)}
		</div>
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
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h3 className="font-medium text-sm">connections</h3>
					<p className="text-[13px] text-muted-foreground">
						the forges this account is linked to. disconnecting stops tripwire
						watching everything that arrived through it.
					</p>
				</div>
				<Button onClick={() => setConnecting(true)} size="sm" variant="outline">
					connect
				</Button>
			</div>

			{isLoading ? (
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-14 rounded-lg" />
					<Skeleton className="h-14 rounded-lg" />
				</div>
			) : connections?.length ? (
				<div className="flex flex-col gap-1.5">
					{connections.map((connection) => (
						<ConnectionRow
							connection={connection}
							key={`${connection.forge}:${connection.accountId}`}
						/>
					))}
				</div>
			) : (
				<p className="rounded-lg bg-surface-0 px-3 py-6 text-center text-[13px] text-muted-foreground">
					no forges connected yet.
				</p>
			)}

			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org}
			/>
		</div>
	);
}
