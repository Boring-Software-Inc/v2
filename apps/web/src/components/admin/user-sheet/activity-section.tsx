import { useQuery } from "@tanstack/react-query";
import { formatStaffDateTime } from "#/components/admin/user-sheet/format";
import {
	FieldRow,
	FieldRows,
	ListRow,
	ListRows,
	QuietLine,
	SheetSectionBlock,
	SubHeading,
} from "#/components/admin/user-sheet/sheet-parts";
import { Button } from "#/components/glaze/ui/button";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { formatWait } from "#/lib/admin-user-sheet";
import { adminUserActivityQueryOptions } from "#/lib/staff-users.query";

function when(value: string | null): string {
	if (!value) {
		return "Unknown";
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : formatStaffDateTime(date);
}

export function ActivitySection({ userId }: { userId: string }) {
	const { data, isLoading, error, refetch, isFetching } = useQuery(
		adminUserActivityQueryOptions(userId),
	);
	return (
		<SheetSectionBlock id="activity" title="Activity">
			{isLoading ? (
				<SkeletonText lines={3} type="body-sm" />
			) : error || !data ? (
				<div className="flex flex-wrap items-center gap-3">
					<QuietLine>Tripwire couldn't load Databuddy activity.</QuietLine>
					<Button
						disabled={isFetching}
						onClick={() => void refetch()}
						size="sm"
						variant="secondary"
					>
						Load activity again
					</Button>
				</div>
			) : !data.connected ? (
				<QuietLine>Databuddy is not connected.</QuietLine>
			) : data.error !== null ? (
				<div className="flex flex-wrap items-center gap-3">
					<QuietLine>Databuddy did not answer: {data.error}</QuietLine>
					<Button
						disabled={isFetching}
						onClick={() => void refetch()}
						size="sm"
						variant="secondary"
					>
						Load activity again
					</Button>
				</div>
			) : !data.profile && data.sessions.length === 0 ? (
				<QuietLine>No Databuddy activity for this profile yet.</QuietLine>
			) : (
				<>
					{data.profile ? (
						<FieldRows>
							<FieldRow label="First seen">
								{when(data.profile.firstSeen)}
							</FieldRow>
							<FieldRow label="Last seen">
								{when(data.profile.lastSeen)}
							</FieldRow>
							<FieldRow label="Sessions">
								{data.profile.sessions ?? "Unknown"}
							</FieldRow>
							<FieldRow label="Pageviews">
								{data.profile.pageviews ?? "Unknown"}
							</FieldRow>
							<FieldRow label="Country">
								{data.profile.country ?? "Unknown"}
							</FieldRow>
							<FieldRow label="Device">
								{data.profile.device ?? "Unknown"}
							</FieldRow>
							<FieldRow label="Browser">
								{data.profile.browser ?? "Unknown"}
							</FieldRow>
						</FieldRows>
					) : null}
					{data.sessions.length > 0 ? (
						<div className="flex flex-col">
							<SubHeading
								count={data.sessions.length}
								title="Recent sessions"
							/>
							<ListRows label="Recent sessions">
								{data.sessions.map((entry) => (
									<ListRow key={entry.id}>
										<span className="min-w-0 flex-1 basis-full text-text-1 sm:basis-0">
											{when(entry.startedAt)}
										</span>
										<span className="text-text-2 sm:w-24 sm:shrink-0">
											{entry.durationSeconds === null
												? "No duration"
												: formatWait(entry.durationSeconds * 1000)}
										</span>
										<span className="text-text-2 tabular-nums sm:w-24 sm:shrink-0">
											{entry.pageviews === null
												? "No pageviews"
												: `${entry.pageviews} ${entry.pageviews === 1 ? "page" : "pages"}`}
										</span>
										<span className="min-w-0 truncate text-text-2 sm:w-40 sm:shrink-0">
											{entry.entryPage ?? "Unknown page"}
										</span>
									</ListRow>
								))}
							</ListRows>
						</div>
					) : null}
				</>
			)}
		</SheetSectionBlock>
	);
}
