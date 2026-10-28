import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AccountPage } from "#/components/account/account-page";
import { ConnectedAgentsPage } from "#/components/agents/connected-agents-page";
import { ConnectionsPage } from "#/components/forges/connections-page";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { OrgBillingPage } from "#/components/organizations/org-billing-page";
import { OrgGeneralSettingsPage } from "#/components/organizations/org-general-settings-page";
import { OrgMembersPage } from "#/components/organizations/org-members-page";
import { OrgRedactionPage } from "#/components/organizations/org-redaction-page";
import { OrgRolesPage } from "#/components/organizations/org-roles-page";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { currentUserQueryOptions } from "#/lib/auth.query";

const orgRoute = getRouteApi("/$org");

function useOrgSlug(): string {
	return orgRoute.useParams().org;
}

export function MembersSettingsPage() {
	return <OrgMembersPage org={useOrgSlug()} />;
}

export function RolesSettingsPage() {
	return <OrgRolesPage org={useOrgSlug()} />;
}

export function GeneralSettingsPage() {
	return <OrgGeneralSettingsPage org={useOrgSlug()} />;
}

export function RedactionSettingsPage() {
	return <OrgRedactionPage org={useOrgSlug()} />;
}

export function ConnectionsSettingsPage() {
	return <ConnectionsPage org={useOrgSlug()} />;
}

export function AgentsSettingsPage() {
	return <ConnectedAgentsPage />;
}

export function BillingSettingsPage() {
	return <OrgBillingPage />;
}

export function AccountSettingsPage() {
	const org = useOrgSlug();
	const { data: user, isPending } = useQuery(currentUserQueryOptions());
	if (isPending) {
		return <SettingsSectionSkeleton />;
	}
	if (!user) {
		return (
			<Empty variant="plain">
				<EmptyHeader>
					<EmptyTitle>Sign in to see your account</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	}
	return <AccountPage org={org} user={user} />;
}
