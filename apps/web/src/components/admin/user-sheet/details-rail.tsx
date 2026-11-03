import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatStaffDate } from "#/components/admin/user-sheet/format";
import { RelativeTime } from "#/design-system/ui/relative-time";
import {
	Body,
	SectionHeading,
	SupportingText,
} from "#/design-system/ui/typography";
import { providerLabel } from "#/lib/admin-user-sheet";
import type { AdminUserView } from "#/lib/staff-users.functions";

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div data-layout-role="user-sheet-detail">
			<dt>
				<SupportingText as="span">{label}</SupportingText>
			</dt>
			<dd>
				<Body as="span">{children}</Body>
			</dd>
		</div>
	);
}

export function DetailsRail({ view }: { view: AdminUserView }) {
	const { user } = view;
	return (
		<section data-layout-role="user-sheet-details">
			<SectionHeading level={3}>Details</SectionHeading>
			<dl>
				<Detail label="Joined">{formatStaffDate(user.createdAt)}</Detail>
				<Detail label="Last seen">
					{user.lastSeenAt ? <RelativeTime date={user.lastSeenAt} /> : "Never"}
				</Detail>
				<Detail label="Timezone">{user.timezone ?? "Not set"}</Detail>
				<Detail label="Personal org">
					{user.personalOrgSlug ? (
						<Link data-layout-role="user-sheet-text-link" to="/admin/orgs">
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
		</section>
	);
}
