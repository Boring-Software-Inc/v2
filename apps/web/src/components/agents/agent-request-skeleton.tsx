import { AgentRequestShell } from "#/components/agents/agent-request-shell";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { SkeletonText } from "#/components/glaze/ui/skeleton";

export function AgentRequestSkeleton() {
	return (
		<AgentRequestShell>
			<div aria-busy className="flex flex-col items-center gap-2">
				<SkeletonText className="w-64" type="heading" />
			</div>
			<Card aria-hidden>
				<CardContent className="flex flex-col gap-3">
					<SkeletonText className="w-48" type="body" />
					<SkeletonText className="w-40" type="body" />
					<SkeletonText className="w-56" type="body" />
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}
