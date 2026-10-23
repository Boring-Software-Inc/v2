import { defineCollection } from "#/lib/collection";
import type { InviteLinkView, OrgMemberView } from "#/lib/org.functions";

export type InviteStatus = "active" | "expired" | "revoked";

export function inviteStatus(
	invite: InviteLinkView,
	now = Date.now(),
): InviteStatus {
	if (invite.revokedAt !== null) {
		return "revoked";
	}
	return new Date(invite.expiresAt).getTime() < now ? "expired" : "active";
}

export const MEMBERS_COLLECTION = defineCollection<OrgMemberView>({
	id: "members",
	noun: "members",
	search: {
		placeholder: "Search name or email",
		fields: (member) => [member.name, member.email],
	},
	filters: [
		{
			key: "role",
			label: "Role",
			kind: "select",
			value: (member) =>
				member.role === "admin" || member.role === "member"
					? member.role
					: "custom",
			options: [
				{ value: "admin", label: "Admin" },
				{ value: "member", label: "Member" },
				{ value: "custom", label: "Custom role" },
			],
		},
	],
});

export const INVITES_COLLECTION = defineCollection<InviteLinkView>({
	id: "invites",
	noun: "invite links",
	filters: [
		{
			key: "status",
			label: "Invite status",
			kind: "segment",
			defaultValue: "active",
			value: (invite) => inviteStatus(invite),
			options: [
				{ value: "active", label: "Active" },
				{ value: "expired", label: "Expired" },
				{ value: "revoked", label: "Revoked" },
			],
		},
	],
});
