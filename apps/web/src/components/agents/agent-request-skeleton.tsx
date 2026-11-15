import { Card, CardContent } from "@tripwire/ui/card";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { AgentRequestShell } from "#/components/agents/agent-request-shell";

const ROW_SLOTS = ["a", "b", "c", "d"] as const;

export function AgentRequestSkeleton() {
	return (
		<AgentRequestShell>
			<div aria-busy data-layout-role="agent-request-skeleton-header">
				<span data-skeleton-line="" aria-hidden data-layout-size="wide">
					<SkeletonText type="heading" />
				</span>
				<span data-skeleton-line="" aria-hidden data-layout-size="wider">
					<SkeletonText type="body" />
				</span>
			</div>
			<Card aria-hidden data-layout-role="agent-request-card">
				<CardContent>
					<div data-layout-role="agent-request-skeleton-lead">
						<Skeleton />
					</div>
					<div data-layout-role="agent-request-skeleton-permissions">
						<span data-skeleton-line="" aria-hidden data-layout-size="short">
							<SkeletonText type="caption" />
						</span>
						{ROW_SLOTS.map((slot) => (
							<span
								data-skeleton-line=""
								aria-hidden
								data-layout-size="wide"
								key={slot}
							>
								<SkeletonText type="body" />
							</span>
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
