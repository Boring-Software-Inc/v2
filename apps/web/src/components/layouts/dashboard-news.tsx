import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "#/design-system/ui/button";
import { useSharedBlocklistPilot } from "#/hooks/use-shared-blocklist-pilot";

export function DashboardNews() {
	const { org, repo, pilot, save, saving } = useSharedBlocklistPilot();
	const navigate = useNavigate();
	if (!pilot) return null;

	return (
		<section aria-label="New in Tripwire" data-layout-role="dashboard-news">
			<h2 data-layout-role="dashboard-news-copy">New in Tripwire</h2>
			<div data-layout-role="dashboard-news-card">
				<h3 data-layout-role="dashboard-news-title">Pilot</h3>
				<p data-layout-role="dashboard-news-copy">
					Send pull requests from listed accounts to Human review.
				</p>
				{pilot.enabled ? (
					<Button
						nativeButton={false}
						size="sm"
						variant="secondary"
						render={
							<Link
								to="/$org/$repo/rules"
								params={{ org, repo }}
								search={{ tab: "installed" }}
								hash="shared-spam-blocklist"
							/>
						}
					>
						View rule
					</Button>
				) : (
					<Button
						disabled={saving}
						onClick={() =>
							save.mutate(true, {
								onSuccess: () => {
									void navigate({
										to: "/$org/$repo/rules",
										params: { org, repo },
										search: { tab: "installed" },
										hash: "shared-spam-blocklist",
									});
								},
							})
						}
						size="sm"
						variant="secondary"
					>
						Turn on
					</Button>
				)}
				{save.isError ? (
					<p role="alert" data-layout-role="dashboard-news-copy">
						Couldn’t save. Try again.
					</p>
				) : null}
			</div>
		</section>
	);
}
