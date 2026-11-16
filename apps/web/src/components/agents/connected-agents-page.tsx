import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tripwire/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@tripwire/ui/item";
import { SkeletonSwap, SkeletonText } from "@tripwire/ui/skeleton";
import {
	EmptyState,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { MetaRow } from "#/components/common/meta-row";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { ZonedTime } from "#/components/timezones/zoned-time";
import {
	type ConnectedAgent,
	revokeConnectedAgent,
} from "#/lib/agents.functions";
import {
	agentQueryKeys,
	connectedAgentsQueryOptions,
} from "#/lib/agents.query";

function AgentRow({ agent }: { agent: ConnectedAgent }) {
	const queryClient = useQueryClient();
	const revoke = useMutation({
		mutationFn: () =>
			revokeConnectedAgent({ data: { clientId: agent.clientId } }),
		onSuccess: () =>
			notify.show({ title: `${agent.name} disconnected` }, "success"),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: agentQueryKeys.lists() }),
	});

	return (
		<Item>
			<ItemContent>
				<ItemTitle>{agent.name}</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>
							{agent.orgs.length
								? agent.orgs.map((org) => org.name).join(", ")
								: "No orgs"}
						</span>
						<span>
							Connected <ZonedTime at={agent.connectedAt} format="short" />
						</span>
						<span>
							{agent.lastUsedAt ? (
								<>
									Used <ZonedTime at={agent.lastUsedAt} format="short" />
								</>
							) : (
								"Not used yet"
							)}
						</span>
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button
					ariaLabel={`Disconnect ${agent.name}`}
					confirmation={{
						confirmLabel: "Disconnect",
						description: `This disconnects ${agent.name} from Tripwire.`,
						title: `Disconnect ${agent.name}?`,
					}}
					onAction={() => revoke.mutateAsync()}
					pending={revoke.isPending}
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

function AgentRowsSkeleton() {
	return (
		<ItemGroup aria-hidden variant="plain">
			{ROW_SLOTS.map((slot) => (
				<Item key={slot}>
					<ItemContent>
						<span data-skeleton-line="" aria-hidden className="w-24">
							<SkeletonText type="label" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-48">
							<SkeletonText type="body-sm" />
						</span>
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

export function ConnectedAgentsPage() {
	const { data: agents, isLoading } = useQuery(connectedAgentsQueryOptions());
	return (
		<>
			<SettingsHeader title="Agents" />
			<SkeletonSwap
				fallback={<AgentRowsSkeleton />}
				label="Loading agents"
				loading={isLoading}
			>
				{agents?.length ? (
					<div className="shell">
						<ItemGroup aria-label="Agents">
							{agents.map((agent) => (
								<AgentRow agent={agent} key={agent.clientId} />
							))}
						</ItemGroup>
					</div>
				) : (
					<EmptyState
						art={<MascotArt mood="admin-table-empty" size="compact" />}
						size="sm"
						variant="plain"
					>
						<EmptyStateHeader>
							<EmptyStateTitle headingLevel={2}>
								No agents connected
							</EmptyStateTitle>
						</EmptyStateHeader>
					</EmptyState>
				)}
			</SkeletonSwap>
		</>
	);
}

import { notify } from "@tripwire/ui/toast";
