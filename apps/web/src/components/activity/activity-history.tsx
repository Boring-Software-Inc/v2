import { useQuery } from "@tanstack/react-query";
import {
	type DigestHistoryInput,
	RUN_RESULT_LABELS,
} from "@tripwire/contracts";
import { EntityCard } from "#/components/common/entity-card";
import { ItemRouterLink } from "#/components/common/router-links";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { ZonedTime } from "#/components/timezones/zoned-time";
import { digestHistoryQueryOptions } from "#/lib/home-digest.query";

const HISTORY_LABELS = { ...RUN_RESULT_LABELS, needs_review: "Human review" };

export function ActivityHistory({ input }: { input: DigestHistoryInput }) {
	const { data, error, isPending } = useQuery(digestHistoryQueryOptions(input));
	return (
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
		>
			{error ? (
				<p className="p-3 type-body-sm">Try opening this history again.</p>
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
									<ItemRouterLink params={{ runId: run.id }} to="/runs/$runId">
										{run.number ? `#${run.number}` : "Run"} ·{" "}
										{HISTORY_LABELS[run.verdict]}
									</ItemRouterLink>
								</ItemTitle>
								<ItemDescription>
									<ZonedTime at={run.createdAt} format="date-time" />
									{run.status === "closed" ? " · Closed before review" : ""}
								</ItemDescription>
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			)}
		</EntityCard>
	);
}
