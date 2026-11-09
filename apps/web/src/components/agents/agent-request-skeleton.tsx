import { AgentRequestShell } from "#/components/agents/agent-request-shell";
import { Card, CardContent } from "#/design-system/ui/card";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

const ROW_SLOTS = ["a", "b", "c", "d"] as const;

export function AgentRequestSkeleton() {
	return (
		<AgentRequestShell>
			<div aria-busy data-layout-role="agent-request-skeleton-header">
				<SkeletonText data-layout-size="wide" type="heading" />
				<SkeletonText data-layout-size="wider" type="body" />
			</div>
			<Card aria-hidden data-layout-role="agent-request-card">
				<CardContent>
					<div data-layout-role="agent-request-skeleton-lead">
						<Skeleton />
					</div>
					<div data-layout-role="agent-request-skeleton-permissions">
						<SkeletonText data-layout-size="short" type="caption" />
						{ROW_SLOTS.map((slot) => (
							<SkeletonText data-layout-size="wide" key={slot} type="body" />
						))}
					</div>
					<div data-layout-role="agent-request-skeleton-org">
						<Skeleton />
					</div>
					<div data-layout-role="agent-request-skeleton-actions">
						<div>
							<Skeleton />
						</div>
						<div>
							<Skeleton />
						</div>
					</div>
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}
