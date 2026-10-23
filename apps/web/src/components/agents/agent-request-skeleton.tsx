import { AgentRequestShell } from "#/components/agents/agent-request-shell";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";

const ROW_SLOTS = ["a", "b", "c", "d"] as const;

export function AgentRequestSkeleton() {
	return (
		<AgentRequestShell>
			<div aria-busy className="flex flex-col items-center gap-1.5">
				<SkeletonText className="w-56" type="heading" />
				<SkeletonText className="w-64" type="body" />
			</div>
			<Card aria-hidden className="w-full">
				<CardContent>
					<Skeleton className="h-16 rounded-tag" />
					<div className="flex flex-col gap-2 px-1 pt-1">
						<SkeletonText className="w-12" type="caption" />
						{ROW_SLOTS.map((slot) => (
							<SkeletonText className="w-56" key={slot} type="body" />
						))}
					</div>
					<Skeleton className="h-(--row) rounded-overlay" />
					<div className="flex gap-2 pt-1">
						<Skeleton className="h-(--control) flex-1 rounded-pill" />
						<Skeleton className="h-(--control) flex-1 rounded-pill" />
					</div>
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}
