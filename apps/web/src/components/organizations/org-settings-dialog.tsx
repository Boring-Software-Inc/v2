import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { OrgRegion } from "@tripwire/contracts";
import { useEffect } from "react";
import { ConnectedAgentsPage } from "#/components/agents/connected-agents-page";
import { ConnectionsPage } from "#/components/forges/connections-page";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/glaze/ui/tabs";
import {
	InsetSheetBody,
	InsetSheetContent,
} from "#/components/layouts/inset-sheet";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { OrgBillingPage } from "#/components/organizations/org-billing-page";
import { OrgGeneralSettingsPage } from "#/components/organizations/org-general-settings-page";
import { OrgMembersPage } from "#/components/organizations/org-members-page";
import { OrgRedactionPage } from "#/components/organizations/org-redaction-page";
import { OrgRolesPage } from "#/components/organizations/org-roles-page";
import {
	orgContextQueryOptions,
	orgInvitesQueryOptions,
	orgMembersQueryOptions,
} from "#/lib/org.query";
import { ORG_SETTINGS_TABS, type OrgSettingsTab } from "#/lib/org-search";
import { pickValue } from "#/lib/pick-value";

const TABS: { value: OrgSettingsTab; label: string; region?: OrgRegion }[] = [
	{ value: "members", label: "Members", region: "members" },
	{ value: "roles", label: "Roles", region: "members" },
	{ value: "settings", label: "General", region: "settings" },
	{ value: "redaction", label: "Redaction", region: "responses" },
	{ value: "connections", label: "Connections" },
	{ value: "agents", label: "Agents" },
	{ value: "billing", label: "Billing" },
];

/**
 * Org settings, presented as a dialog over whatever page you're on —
 * not a dedicated route. The open tab lives in the URL (`?settings=members`),
 * so it's still deep-linkable and back-button friendly; closing just drops the
 * search param. Role-gated controls live in the panes (the server is the real
 * boundary).
 */
export function OrgSettingsDialog() {
	const params = useParams({ strict: false });
	const { settings: tab } = useSearch({ strict: false });
	const navigate = useNavigate();
	const org = params.org;

	const queryClient = useQueryClient();
	const { data: orgContext } = useQuery({
		...orgContextQueryOptions(org ?? ""),
		enabled: Boolean(org),
	});
	const open = Boolean(org && tab);
	const isAdmin = orgContext?.permissions.includes("members:manage") ?? false;
	const tabs = TABS.filter(
		(item) =>
			!item.region ||
			(orgContext?.permissions.includes(`${item.region}:read`) ?? false),
	);
	const current =
		tabs.find((item) => item.value === tab)?.value ?? tabs[0]?.value;

	useEffect(() => {
		if (!open || !org) {
			return;
		}
		if (orgContext?.permissions.includes("members:read")) {
			queryClient.prefetchQuery(orgMembersQueryOptions(org));
		}
		if (isAdmin) {
			queryClient.prefetchQuery(orgInvitesQueryOptions(org));
		}
	}, [open, org, isAdmin, orgContext, queryClient]);

	if (!org) {
		return null;
	}

	const setTab = (next: OrgSettingsTab | undefined) =>
		navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				settings: next,
				invites: next ? prev.invites : undefined,
			}),
			replace: Boolean(tab && next),
			resetScroll: false,
		});

	const name = orgContext?.name ?? org;

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!next) {
					setTab(undefined);
				}
			}}
			open={open}
		>
			<InsetSheetContent>
				<Tabs
					className="flex min-h-0 flex-1 flex-col gap-0"
					onValueChange={(value) =>
						setTab(pickValue(ORG_SETTINGS_TABS, String(value)))
					}
					value={current}
				>
					<DialogHeader className="gap-3 group-data-close/dialog:pe-3 sm:group-data-close/dialog:pe-4">
						<div className="flex items-center gap-3 pe-8">
							<OrgAvatar
								animate
								hue={orgContext?.avatarHue}
								name={name}
								replayToken={open ? 1 : 0}
								size="lg"
							/>
							<div className="flex min-w-0 flex-col gap-0.5">
								<DialogTitle>{name}</DialogTitle>
								<DialogDescription>Org settings</DialogDescription>
							</div>
						</div>
						<TabsList
							aria-label="Org settings"
							className="[--density-tab-x:var(--space-2)] sm:[--density-tab-x:var(--space-4)]"
						>
							{tabs.map((item) => (
								<TabsTrigger key={item.value} value={item.value}>
									{item.label}
								</TabsTrigger>
							))}
						</TabsList>
					</DialogHeader>
					<InsetSheetBody>
						{current === "members" ? (
							<TabsContent value="members">
								<OrgMembersPage org={org} />
							</TabsContent>
						) : null}
						{current === "roles" ? (
							<TabsContent value="roles">
								<OrgRolesPage org={org} />
							</TabsContent>
						) : null}
						{current === "settings" ? (
							<TabsContent value="settings">
								<OrgGeneralSettingsPage org={org} />
							</TabsContent>
						) : null}
						{current === "redaction" ? (
							<TabsContent value="redaction">
								<OrgRedactionPage org={org} />
							</TabsContent>
						) : null}
						<TabsContent value="connections">
							<ConnectionsPage org={org} />
						</TabsContent>
						<TabsContent value="agents">
							<ConnectedAgentsPage />
						</TabsContent>
						<TabsContent value="billing">
							<OrgBillingPage />
						</TabsContent>
					</InsetSheetBody>
				</Tabs>
			</InsetSheetContent>
		</Dialog>
	);
}
