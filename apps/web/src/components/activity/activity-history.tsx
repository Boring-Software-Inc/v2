import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	type DigestHistoryInput,
	RUN_RESULT_LABELS,
} from "@tripwire/contracts";
import { EntityCard } from "#/components/common/entity-card";
import { ItemRouterLink } from "#/components/common/router-links";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { digestHistoryQueryOptions } from "#/lib/home-digest.query";

const HISTORY_LABELS = { ...RUN_RESULT_LABELS, needs_review: "Human review" };

export function ActivityHistory({ input }: { input: DigestHistoryInput }) {
	const { data, error, isPending } = useQuery(digestHistoryQueryOptions(input));
	const label =
		input.verdict === "all" ? "All verdicts" : HISTORY_LABELS[input.verdict];
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Activity history</h1>
						<p className="type-body text-text-2">
							{label} runs from <ZonedTime at={input.from} format="date-time" />{" "}
							to <ZonedTime at={input.to} format="date-time" />.
						</p>
						<p className="type-body-sm text-text-2">
							Verdicts recorded in this period, including repeated checks and
							reviews closed before a decision. These are historical runs, not
							the pending review queue.
						</p>
					</header>
					<EntityCard
						title={
							isPending
								? "Loading runs"
								: error
									? "Could not load runs"
									: `${data?.total ?? 0} runs`
						}
						flush
						footerMeta={
							data && data.total > data.runs.length
								? `Showing the latest ${data.runs.length} of ${data.total} runs`
								: undefined
						}
						footerActions={
							<Button
								nativeButton={false}
								render={
									<Link
										params={{ org: input.org, repo: input.repo }}
										search={{ verdict: "all" }}
										to="/$org/$repo/activity"
									/>
								}
								size="sm"
								variant="secondary"
							>
								Open current activity
							</Button>
						}
					>
						{error ? (
							<p className="p-3 type-body-sm">
								Try opening this history again.
							</p>
						) : data?.total === 0 ? (
							<p className="p-3 type-body-sm">
								No runs match this verdict and period.
							</p>
						) : (
							<ItemGroup aria-label="Runs in this period" variant="plain">
								{data?.runs.map((run) => (
									<Item key={run.id}>
										<ItemContent>
											<ItemTitle>
												<ItemRouterLink
													params={{ runId: run.id }}
													to="/runs/$runId"
												>
													{run.number ? `#${run.number}` : "Run"} ·{" "}
													{HISTORY_LABELS[run.verdict]}
												</ItemRouterLink>
											</ItemTitle>
											<ItemDescription>
												<ZonedTime at={run.createdAt} format="date-time" />
												{run.status === "closed"
													? " · Closed before review"
													: ""}
											</ItemDescription>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						)}
					</EntityCard>
				</div>
			</div>
		</DashboardLayout>
	);
}
