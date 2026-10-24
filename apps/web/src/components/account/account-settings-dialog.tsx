import { useState } from "react";
import { AccountGeneralPage } from "#/components/account/account-general-page";
import { AccountOrgsPage } from "#/components/account/account-orgs-page";
import { AccountSessionsPage } from "#/components/account/account-sessions-page";
import { ConnectedAgentsPage } from "#/components/agents/connected-agents-page";
import { ConnectionsPage } from "#/components/forges/connections-page";
import { Avatar } from "#/components/glaze/ui/avatar";
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
import type { CurrentUser } from "#/lib/auth.functions";
import { pickValue } from "#/lib/pick-value";

const ACCOUNT_SETTINGS_TABS = [
	"general",
	"sessions",
	"orgs",
	"connections",
	"agents",
] as const;

type AccountSettingsTab = (typeof ACCOUNT_SETTINGS_TABS)[number];

const TABS: { value: AccountSettingsTab; label: string }[] = [
	{ value: "general", label: "General" },
	{ value: "sessions", label: "Sessions" },
	{ value: "orgs", label: "Orgs" },
	{ value: "connections", label: "Connections" },
	{ value: "agents", label: "Agents" },
];

export function AccountSettingsDialog({
	open,
	onOpenChange,
	user,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: CurrentUser;
}) {
	const [tab, setTab] = useState<AccountSettingsTab>("general");
	const close = () => onOpenChange(false);

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setTab("general");
				}
			}}
			open={open}
		>
			<InsetSheetContent>
				<Tabs
					className="flex min-h-0 flex-1 flex-col gap-0"
					onValueChange={(value) =>
						setTab(pickValue(ACCOUNT_SETTINGS_TABS, String(value)) ?? "general")
					}
					value={tab}
				>
					<DialogHeader className="gap-3 group-data-close/dialog:pe-3 sm:group-data-close/dialog:pe-4">
						<div className="flex items-center gap-3 pe-8">
							<Avatar
								decorative
								name={user.name}
								size="lg"
								src={user.image || undefined}
							/>
							<div className="flex min-w-0 flex-col gap-0.5">
								<DialogTitle>{user.name}</DialogTitle>
								<DialogDescription>Account settings</DialogDescription>
							</div>
						</div>
						<TabsList
							aria-label="Account settings"
							className="[--density-tab-x:var(--space-2)] sm:[--density-tab-x:var(--space-4)]"
						>
							{TABS.map((item) => (
								<TabsTrigger key={item.value} value={item.value}>
									{item.label}
								</TabsTrigger>
							))}
						</TabsList>
					</DialogHeader>
					<InsetSheetBody>
						{tab === "general" ? (
							<TabsContent value="general">
								<AccountGeneralPage onLeave={close} user={user} />
							</TabsContent>
						) : null}
						{tab === "sessions" ? (
							<TabsContent value="sessions">
								<AccountSessionsPage />
							</TabsContent>
						) : null}
						{tab === "orgs" ? (
							<TabsContent value="orgs">
								<AccountOrgsPage onOpenOrg={close} />
							</TabsContent>
						) : null}
						<TabsContent value="connections">
							<ConnectionsPage org={null} />
						</TabsContent>
						<TabsContent value="agents">
							<ConnectedAgentsPage />
						</TabsContent>
					</InsetSheetBody>
				</Tabs>
			</InsetSheetContent>
		</Dialog>
	);
}
