import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { MetaRow } from "#/components/common/meta-row";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { SkeletonSwap, SkeletonText } from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
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
	const [confirming, setConfirming] = useState(false);
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
					onClick={() => setConfirming(true)}
					size="sm"
					variant="secondary"
				>
					Disconnect
				</Button>
			</ItemActions>
			<ConfirmDeleteDialog
				actionLabel="Disconnect"
				confirmText={agent.name}
				onConfirm={() => revoke.mutateAsync()}
				onOpenChange={setConfirming}
				open={confirming}
				pendingLabel="Disconnecting"
				title={`Disconnect ${agent.name}?`}
			/>
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
					<Empty size="sm" variant="plain">
						<EmptyHeader>
							<EmptyTitle>No agents connected</EmptyTitle>
						</EmptyHeader>
					</Empty>
				)}
			</SkeletonSwap>
		</>
	);
}
