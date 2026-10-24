import { formatStaffDateTime } from "#/components/admin/user-sheet/format";
import {
	FieldRow,
	FieldRows,
	SheetSectionBlock,
} from "#/components/admin/user-sheet/sheet-parts";
import { useStaffAction } from "#/components/admin/user-sheet/use-staff-action";
import { External, Icon } from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import { reviewUserAccess } from "#/lib/admin.functions";
import { formatWait } from "#/lib/admin-user-sheet";
import type { AdminUserView } from "#/lib/staff-users.functions";

export function useAccessReview(userId: string, name: string) {
	return useStaffAction<"approve" | "reject">({
		userId,
		run: async (decision) => {
			await reviewUserAccess({ data: { userIds: [userId], decision } });
			return { ok: true };
		},
		failure: "Tripwire couldn't save the access decision. Try again.",
		success: (decision) =>
			decision === "approve" ? `Approved ${name}` : `Declined ${name}`,
	});
}

export function AccessSection({
	view,
	now,
}: {
	view: AdminUserView;
	now: number;
}) {
	const { user } = view;
	const review = useAccessReview(user.id, user.name);
	const requested = user.waitlistedAt ?? user.createdAt;
	const pending = user.accessStatus === "pending";
	const action =
		user.accessStatus === "approved" ? (
			<Button
				disabled={review.isPending}
				onClick={() => review.mutate("reject")}
				size="sm"
				variant="secondary"
			>
				Decline
			</Button>
		) : user.accessStatus === "rejected" ? (
			<Button
				disabled={review.isPending}
				onClick={() => review.mutate("approve")}
				size="sm"
				variant="secondary"
			>
				Approve
			</Button>
		) : null;
	return (
		<SheetSectionBlock action={action} id="access" title="Access">
			<FieldRows>
				{user.reviewedBy ? (
					<FieldRow label="Reviewed by">
						<Avatar decorative name={user.reviewedBy.name} size="xs" />
						<span className="truncate">{user.reviewedBy.name}</span>
					</FieldRow>
				) : null}
				{user.accessReviewedAt ? (
					<FieldRow label="Reviewed">
						{formatStaffDateTime(user.accessReviewedAt)}
					</FieldRow>
				) : null}
				<FieldRow label="Requested">{formatStaffDateTime(requested)}</FieldRow>
				{pending ? (
					<FieldRow label="Waiting">
						<span className="text-warn-text">
							{formatWait(now - new Date(requested).getTime())}
						</span>
					</FieldRow>
				) : user.accessReviewedAt ? (
					<FieldRow label="Waited">
						{formatWait(
							new Date(user.accessReviewedAt).getTime() -
								new Date(requested).getTime(),
						)}
					</FieldRow>
				) : null}
				{pending && user.login ? (
					<FieldRow label="GitHub">
						<a
							className="inline-flex items-center gap-1 rounded-tag text-text-1 underline decoration-line-control underline-offset-3 hover:decoration-ink focus-visible:focus-ring"
							href={`https://github.com/${user.login}`}
							rel="noreferrer"
							target="_blank"
						>
							{user.login}
							<Icon icon={External} size={12} />
						</a>
					</FieldRow>
				) : null}
			</FieldRows>
		</SheetSectionBlock>
	);
}
