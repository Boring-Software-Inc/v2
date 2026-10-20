import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { ConnectionsPage } from "#/components/forges/connections-page";
import {
	Dialog,
	DialogBody,
	DialogContent,
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
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { OrgBillingPage } from "#/components/organizations/org-billing-page";
import { OrgGeneralSettingsPage } from "#/components/organizations/org-general-settings-page";
import { OrgMembersPage } from "#/components/organizations/org-members-page";
import {
	type OrgSettingsTab,
	parseOrgSettingsTab,
} from "#/components/organizations/org-settings-tab";
import {
	orgContextQueryOptions,
	orgInvitesQueryOptions,
	orgMembersQueryOptions,
} from "#/lib/org.query";

const TABS: { value: OrgSettingsTab; label: string }[] = [
	{ value: "members", label: "Members" },
	{ value: "settings", label: "Settings" },
	{ value: "connections", label: "Connections" },
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
	const search = useSearch({ strict: false }) as { settings?: unknown };
	const navigate = useNavigate();
	const org = params.org;
	const tab = parseOrgSettingsTab(search.settings);

	const queryClient = useQueryClient();
	const { data: orgContext } = useQuery({
		...orgContextQueryOptions(org ?? ""),
		enabled: Boolean(org),
	});
	const open = Boolean(org && tab);
	const isAdmin = orgContext?.role === "admin";

	useEffect(() => {
		if (!open || !org) {
			return;
		}
		queryClient.prefetchQuery(orgMembersQueryOptions(org));
		if (isAdmin) {
			queryClient.prefetchQuery(orgInvitesQueryOptions(org));
		}
	}, [open, org, isAdmin, queryClient]);

	if (!org) {
		return null;
	}

	const setTab = (next: OrgSettingsTab | undefined) =>
		navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				settings: next,
			}),
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
			<DialogContent className="h-full" size="lg">
				<Tabs
					className="flex min-h-0 flex-1 flex-col gap-0"
					onValueChange={(value) => setTab(parseOrgSettingsTab(value))}
					value={tab ?? "members"}
				>
					<DialogHeader className="gap-3">
						<div className="flex items-center gap-3">
							<OrgAvatar name={name} size="lg" />
							<div className="flex min-w-0 flex-col gap-0.5">
								<DialogTitle>{name}</DialogTitle>
								<DialogDescription>Org settings</DialogDescription>
							</div>
						</div>
						<TabsList aria-label="Org settings">
							{TABS.map((item) => (
								<TabsTrigger key={item.value} value={item.value}>
									{item.label}
								</TabsTrigger>
							))}
						</TabsList>
					</DialogHeader>
					<DialogBody>
						<TabsContent value="members">
							<OrgMembersPage org={org} />
						</TabsContent>
						<TabsContent value="settings">
							<OrgGeneralSettingsPage org={org} />
						</TabsContent>
						<TabsContent value="connections">
							<ConnectionsPage org={org} />
						</TabsContent>
						<TabsContent value="billing">
							<OrgBillingPage />
						</TabsContent>
					</DialogBody>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
