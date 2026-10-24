import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatStaffDate } from "#/components/admin/user-sheet/format";
import { RelativeTime } from "#/components/glaze/ui/relative-time";
import { providerLabel } from "#/lib/admin-user-sheet";
import type { AdminUserView } from "#/lib/staff-users.functions";

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-3">
			<dt className="w-24 shrink-0 type-body-sm text-text-2">{label}</dt>
			<dd className="min-w-0 break-words type-body-sm text-text-1">
				{children}
			</dd>
		</div>
	);
}

export function DetailsRail({ view }: { view: AdminUserView }) {
	const { user } = view;
	return (
		<div className="flex flex-col gap-3">
			<h3 className="pb-1 type-label text-text-1">Details</h3>
			<dl className="flex flex-col gap-3">
				<Detail label="Joined">{formatStaffDate(user.createdAt)}</Detail>
				<Detail label="Last seen">
					{user.lastSeenAt ? <RelativeTime date={user.lastSeenAt} /> : "Never"}
				</Detail>
				<Detail label="Timezone">{user.timezone ?? "Not set"}</Detail>
				<Detail label="Personal org">
					{user.personalOrgSlug ? (
						<Link
							className="rounded-tag underline decoration-line-control underline-offset-3 hover:decoration-ink focus-visible:focus-ring"
							to="/admin/orgs"
						>
							{user.personalOrgSlug}
						</Link>
					) : (
						"None"
					)}
				</Detail>
				<Detail label="Signed in with">
					{user.providers.length > 0
						? user.providers.map(providerLabel).join(", ")
						: "Unknown"}
				</Detail>
				<Detail label="Email">
					{user.emailVerified ? "Verified" : "Not verified"}
				</Detail>
			</dl>
		</div>
	);
}
