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
import { Button } from "#/design-system/ui/button";
import { SkeletonText } from "#/design-system/ui/skeleton";
import { Body, SupportingText } from "#/design-system/ui/typography";
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
				<div data-layout-role="user-sheet-inline-state">
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
				<div data-layout-role="user-sheet-inline-state">
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
						<div data-layout-role="user-sheet-subsection">
							<SubHeading
								count={data.sessions.length}
								title="Recent sessions"
							/>
							<ListRows label="Recent sessions">
								{data.sessions.map((entry) => (
									<ListRow key={entry.id}>
										<Body as="span">{when(entry.startedAt)}</Body>
										<SupportingText as="span">
											{entry.durationSeconds === null
												? "No duration"
												: formatWait(entry.durationSeconds * 1000)}
										</SupportingText>
										<SupportingText as="span">
											{entry.pageviews === null
												? "No pageviews"
												: `${entry.pageviews} ${entry.pageviews === 1 ? "page" : "pages"}`}
										</SupportingText>
										<SupportingText as="span">
											{entry.entryPage ?? "Unknown page"}
										</SupportingText>
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
