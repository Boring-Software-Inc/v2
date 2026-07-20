import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { OrgBillingPage } from "#/components/organizations/org-billing-page";
import { OrgGeneralSettingsPage } from "#/components/organizations/org-general-settings-page";
import { OrgMembersPage } from "#/components/organizations/org-members-page";
import {
	type OrgSettingsTab,
	parseOrgSettingsTab,
} from "#/components/organizations/org-settings-tab";
import { InsetDialog } from "#/components/ui/inset-dialog";
import {
	orgContextQueryOptions,
	orgInvitesQueryOptions,
	orgMembersQueryOptions,
} from "#/lib/org.query";
import { cn } from "#/lib/utils";

const TABS: OrgSettingsTab[] = ["members", "settings", "billing"];

/**
 * Org settings, presented as an inset dialog over whatever page you're on —
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
	const close = () => setTab(undefined);

	return (
		<InsetDialog className="h-[92dvh]" onClose={close} open={Boolean(tab)}>
			<header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-4">
				<div className="flex items-center gap-3">
					<OrgAvatar
						hue={orgContext?.avatarHue}
						name={orgContext?.name ?? org}
						size={28}
					/>
					<div>
						<h2 className="font-semibold text-base leading-tight">
							{orgContext?.name ?? org}
						</h2>
						<p className="text-muted-foreground text-xs">org settings</p>
					</div>
				</div>
				<button
					aria-label="Close"
					className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
					onClick={close}
					type="button"
				>
					<HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
				</button>
			</header>

			<nav className="flex shrink-0 items-center gap-1 border-b px-5">
				{TABS.map((item) => (
					<button
						className={cn(
							"-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors",
							item === tab
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						key={item}
						onClick={() => setTab(item)}
						type="button"
					>
						{item}
					</button>
				))}
			</nav>

			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
				{tab === "members" ? <OrgMembersPage org={org} /> : null}
				{tab === "settings" ? <OrgGeneralSettingsPage org={org} /> : null}
				{tab === "billing" ? <OrgBillingPage /> : null}
			</div>
		</InsetDialog>
	);
}
