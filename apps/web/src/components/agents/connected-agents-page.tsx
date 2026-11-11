import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MetaRow } from "#/components/common/meta-row";
import { MascotArt } from "#/components/mascot/mascot-art";
import { SettingsHeader } from "#/components/settings/settings-frame";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { Button } from "#/design-system/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "#/design-system/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/design-system/ui/item";
import { SkeletonSwap, SkeletonText } from "#/design-system/ui/skeleton";
import { toast } from "#/design-system/ui/toast";
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
		onSuccess: () => toast.success(`${agent.name} disconnected`),
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
					aria-label={`Disconnect ${agent.name}`}
					confirmation={{
						actionLabel: "Disconnect",
						confirmText: agent.name,
						pendingLabel: "Disconnecting",
						title: `Disconnect ${agent.name}?`,
					}}
					onAction={() => revoke.mutateAsync()}
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

function AgentRowsSkeleton() {
	return (
		<ItemGroup aria-hidden variant="plain">
			{ROW_SLOTS.map((slot) => (
				<Item key={slot}>
					<ItemContent>
						<SkeletonText className="w-24" type="label" />
						<SkeletonText className="w-48" type="body-sm" />
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
					<Empty
						art={<MascotArt mood="admin-table-empty" size="compact" />}
						size="sm"
						variant="plain"
					>
						<EmptyHeader>
							<EmptyTitle>No agents connected</EmptyTitle>
						</EmptyHeader>
					</Empty>
				)}
			</SkeletonSwap>
		</>
	);
}
