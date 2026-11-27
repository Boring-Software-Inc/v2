import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Avatar } from "@tripwire/ui/avatar";
import { Command, type CommandEntry } from "@tripwire/ui/command";
import { Dialog } from "@tripwire/ui/dialog";
import {
	Add,
	ChevronDown,
	Comment,
	Dark,
	Icon,
	Light,
	More,
	SignOut,
} from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { UI_MOTION } from "@tripwire/ui/motion";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import { type ComponentPropsWithRef, type ReactNode, useState } from "react";
import { useFeedback } from "#/components/feedback";
import { CreateOrgDialog } from "#/components/organizations/create-org-dialog";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { useOrgSwitchPath } from "#/hooks/use-org-switch-path";
import { useSignOut } from "#/hooks/use-sign-out";
import type { CurrentUser } from "#/lib/auth.functions";
import { accountIdentity, PLACEHOLDER_USER } from "#/lib/current-user";
import type { OrgWithRole } from "#/lib/org.functions";
import { myOrgsQueryOptions } from "#/lib/org.query";

const VISIBLE_OTHER_ORGS = 3;
const WORKSPACE_DIALOG_BATCH_SIZE = 5;

interface SidebarAccountTriggerProps
	extends Omit<ComponentPropsWithRef<"button">, "children" | "className"> {
	avatar: ReactNode;
	collapsed: boolean;
	name: string;
}

export function SidebarAccountTrigger({
	avatar,
	collapsed,
	name,
	ref,
	type = "button",
	...buttonProps
}: SidebarAccountTriggerProps) {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : UI_MOTION.state;
	return (
		<button
			{...buttonProps}
			data-collapsed={collapsed ? "" : undefined}
			data-layout-role="sidebar-account-trigger"
			ref={ref}
			type={type}
		>
			{avatar}
			<AnimatePresence initial={false} mode="popLayout">
				{collapsed ? null : (
					<motion.span
						animate={{ opacity: 1, transform: "translateX(0px)" }}
						data-layout-role="sidebar-account-label"
						exit={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						initial={{
							opacity: 0,
							transform: "translateX(calc(var(--space-1) * -1))",
						}}
						transition={transition}
					>
						{name}
					</motion.span>
				)}
			</AnimatePresence>
		</button>
	);
}

function visibleOtherOrganizations(
	organizations: OrgWithRole[],
	activeOrganizationId: string | null,
) {
	const others = organizations.filter(
		(candidate) => candidate.id !== activeOrganizationId,
	);
	return {
		organizations: others.slice(0, VISIBLE_OTHER_ORGS),
		hasMore: others.length > VISIBLE_OTHER_ORGS,
	};
}

export function AccountMenu({
	user,
	collapsed = false,
}: {
	user: CurrentUser | null;
	collapsed?: boolean;
}) {
	const navigate = useNavigate();
	const orgSwitchPath = useOrgSwitchPath();
	const { org } = useActiveScope();
	const { data: organizations = [] } = useQuery(myOrgsQueryOptions());
	const { start: openFeedback } = useFeedback();
	const signOut = useSignOut();
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = hasMounted && resolvedTheme === "dark";
	const [allOpen, setAllOpen] = useState(false);
	const [createOrgOpen, setCreateOrgOpen] = useState(false);
	const moderator = user ?? PLACEHOLDER_USER;
	const identity = accountIdentity(moderator);
	const visible = visibleOtherOrganizations(organizations, org?.id ?? null);

	function selectOrganization(slug: string) {
		setAllOpen(false);
		navigate({ to: orgSwitchPath(slug) });
	}

	const trigger = (
		<SidebarAccountTrigger
			aria-label={`Account menu for ${moderator.name}`}
			avatar={
				<Avatar
					decorative
					name={moderator.name}
					src={moderator.image || undefined}
				/>
			}
			collapsed={collapsed}
			name={moderator.name}
		/>
	);
	const menuItems: MenuEntry[] = [
		...(org
			? [
					{
						label: "Active workspace",
						type: "label" as const,
						value: "active-workspace-label",
					},
					{
						badge: org.isPersonal ? { label: "Personal" } : undefined,
						icon: <OrgAvatar hue={org.avatarHue} name={org.name} size="sm" />,
						label: org.name,
						selected: true,
						type: "summary" as const,
						value: "active-workspace",
					},
					{ type: "separator" as const, value: "workspaces-separator" },
				]
			: []),
		{
			items: [
				...visible.organizations.map(
					(candidate): MenuEntry => ({
						icon: (
							<OrgAvatar
								hue={candidate.avatarHue}
								name={candidate.name}
								size="sm"
							/>
						),
						badge: candidate.isPersonal ? { label: "Personal" } : undefined,
						label: candidate.name,
						onAction: () => selectOrganization(candidate.slug),
						value: `workspace:${candidate.id}`,
					}),
				),
				...(visible.hasMore
					? [
							{
								icon: <Icon icon={More} />,
								label: "Show all",
								onAction: () => setAllOpen(true),
								value: "show-all",
							},
						]
					: [
							{
								icon: <Icon icon={Add} />,
								label: "Create org",
								onAction: () => setCreateOrgOpen(true),
								value: "create-org",
							},
						]),
			],
			label: "Other workspaces",
			type: "group",
			value: "other-workspaces",
		},
		{ type: "separator", value: "account-separator" },
		{
			description: identity ?? undefined,
			href: org ? `/${org.slug}/settings/account` : "/account",
			icon: (
				<Avatar
					decorative
					name={moderator.name}
					src={moderator.image || undefined}
				/>
			),
			label: moderator.name,
			type: "link",
			value: "account-summary",
		},
		{
			icon: <Icon icon={Comment} />,
			label: "Send feedback",
			onAction: () => openFeedback?.(),
			value: "send-feedback",
		},
		{
			icon: <Icon icon={isDark ? Light : Dark} />,
			label: isDark ? "Light theme" : "Dark theme",
			onAction: () => setTheme(isDark ? "light" : "dark"),
			value: "toggle-theme",
		},
		{
			confirmation: {
				confirmLabel: "Sign out",
				description:
					"Your session on this device ends. You'll need to sign in again to use Tripwire.",
				title: "Sign out of Tripwire?",
			},
			icon: <Icon icon={SignOut} />,
			label: "Sign out",
			onAction: () => signOut.mutateAsync(),
			tone: "destructive" as const,
			value: "sign-out",
		},
	];

	return (
		<>
			<div data-layout-role="account-menu-trigger">
				<Menu
					align="start"
					ariaLabel={`Account menu for ${moderator.name}`}
					items={menuItems}
					offset="tight"
					placement="top"
					trigger={trigger}
					triggerTooltip={
						collapsed
							? {
									children: "Account",
									offset: "spacious",
									placement: "right",
									variant: "sidebar",
								}
							: undefined
					}
					width="popover"
				/>
			</div>
			{allOpen ? (
				<OrganizationDialog
					onCreate={() => {
						setAllOpen(false);
						setCreateOrgOpen(true);
					}}
					onOpenChange={setAllOpen}
					onSelect={selectOrganization}
					open
					organizations={organizations}
					selectedId={org?.id ?? null}
				/>
			) : null}
			<CreateOrgDialog
				onCreated={(slug) => {
					setCreateOrgOpen(false);
					navigate({ params: { org: slug }, to: "/$org/home" });
				}}
				onOpenChange={setCreateOrgOpen}
				open={createOrgOpen}
			/>
		</>
	);
}

function OrganizationDialog({
	organizations,
	selectedId,
	open,
	onOpenChange,
	onSelect,
	onCreate,
}: {
	organizations: OrgWithRole[];
	selectedId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (slug: string) => void;
	onCreate: () => void;
}) {
	const count = organizations.length;
	const [query, setQuery] = useState("");
	const [visibleCount, setVisibleCount] = useState(WORKSPACE_DIALOG_BATCH_SIZE);
	const searching = query.trim().length > 0;
	const shownOrganizations = searching
		? organizations
		: organizations.slice(0, visibleCount);
	const hasMore = !searching && shownOrganizations.length < count;

	function revealMoreOrganizations() {
		setVisibleCount(
			Math.min(visibleCount + WORKSPACE_DIALOG_BATCH_SIZE, count),
		);
	}
	const commandItems: CommandEntry[] = [
		{
			items: shownOrganizations.map((candidate) => ({
				badge:
					candidate.id === selectedId
						? "Current"
						: candidate.isPersonal
							? "Personal"
							: undefined,
				current: candidate.id === selectedId,
				icon: (
					<OrgAvatar
						hue={candidate.avatarHue}
						name={candidate.name}
						size="sm"
					/>
				),
				keywords: [candidate.slug],
				label: candidate.name,
				onAction: () => onSelect(candidate.slug),
				value: candidate.id,
			})),
			label: "Workspaces",
			type: "group",
		},
		{
			items: [
				...(hasMore
					? [
							{
								icon: <Icon icon={ChevronDown} />,
								label: "View more",
								onAction: revealMoreOrganizations,
								value: "view-more",
							},
						]
					: []),
				{
					icon: <Icon icon={Add} />,
					label: "Create org",
					onAction: onCreate,
					value: "create-org",
				},
			],
			label: "Actions",
			type: "group",
		},
	];

	return (
		<Dialog
			cancelLabel="Close"
			description="Switch the dashboard to another workspace."
			initialFocus="first-field"
			onOpenChange={onOpenChange}
			open={open}
			title="Choose a workspace"
		>
			<div data-layout-role="workspace-picker">
				<Command
					ariaLabel="Workspaces"
					autoFocus
					emptyLabel="No workspaces match"
					items={commandItems}
					onQueryChange={setQuery}
					placeholder="Search workspaces"
				/>
			</div>
		</Dialog>
	);
}
