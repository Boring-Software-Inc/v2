import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "#/design-system/ui/button";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useOrgPermission } from "#/hooks/use-org-permission";
import {
	getSharedBlocklistPilot,
	setSharedBlocklistPilot,
} from "#/lib/shared-blocklist.functions";

export function DashboardNews() {
	const scope = useActiveScope();
	const org = scope.org?.slug ?? "";
	const repo = scope.repo ?? "";
	const canManage = useOrgPermission(org, "rules:manage");
	const queryClient = useQueryClient();
	const queryKey = ["shared-blocklist-pilot", org, repo] as const;
	const pilot = useQuery({
		queryKey,
		queryFn: () => getSharedBlocklistPilot({ data: { org, repo } }),
		enabled: Boolean(org && repo && canManage),
		retry: false,
	});
	const save = useMutation({
		mutationFn: (enabled: boolean) =>
			setSharedBlocklistPilot({ data: { org, repo, enabled } }),
		onSuccess: (result) => queryClient.setQueryData(queryKey, result),
	});
	if (!canManage || !pilot.data) return null;
	const { enabled } = pilot.data;

	return (
		<section aria-label="New in Tripwire" data-layout-role="dashboard-news">
			<h2 data-layout-role="dashboard-news-copy">New in Tripwire</h2>
			<div data-layout-role="dashboard-news-card">
				<h3 data-layout-role="dashboard-news-title">
					Review matches from the shared spam blocklist
				</h3>
				<p data-layout-role="dashboard-news-copy">
					Send matching pull requests to Human review.
				</p>
				<Button
					disabled={save.isPending}
					onClick={() => save.mutate(!enabled)}
					size="sm"
					variant="secondary"
				>
					{enabled ? "Turn off" : "Turn on"}
				</Button>
				{save.isError ? (
					<p role="alert" data-layout-role="dashboard-news-copy">
						Couldn’t save. Try again.
					</p>
				) : null}
			</div>
		</section>
	);
}
