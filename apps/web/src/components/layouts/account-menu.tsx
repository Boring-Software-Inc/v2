import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { useFeedback } from "#/components/feedback";
import { CreateOrgDialog } from "#/components/organizations/create-org-dialog";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	Add,
	Check,
	ChevronDown,
	Comment,
	Dark,
	Icon,
	Light,
	More,
	SignOut,
} from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandLabel,
	CommandList,
} from "#/design-system/ui/command";
import {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/design-system/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuLinkItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/design-system/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { useSignOut } from "#/hooks/use-sign-out";
import type { CurrentUser } from "#/lib/auth.functions";
import { accountIdentity, PLACEHOLDER_USER } from "#/lib/current-user";
import type { OrgWithRole } from "#/lib/org.functions";
import { myOrgsQueryOptions } from "#/lib/org.query";

const VISIBLE_OTHER_ORGS = 4;
const WORKSPACE_DIALOG_BATCH_SIZE = 5;
const KEEP_ABOVE_TRIGGER = { side: "none", align: "shift" } as const;

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
	const { org } = useActiveScope();
	const { data: organizations = [] } = useQuery(myOrgsQueryOptions());
	const { start: openFeedback } = useFeedback();
	const signOut = useSignOut();
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = hasMounted && resolvedTheme === "dark";
	const [allOpen, setAllOpen] = useState(false);
	const [createOrgOpen, setCreateOrgOpen] = useState(false);
	const [signOutOpen, setSignOutOpen] = useState(false);
	const moderator = user ?? PLACEHOLDER_USER;
	const identity = accountIdentity(moderator);
	const visible = visibleOtherOrganizations(organizations, org?.id ?? null);

	function selectOrganization(slug: string) {
		setAllOpen(false);
		navigate({ to: "/$org/home", params: { org: slug } });
	}

	const trigger = (
		<DropdownMenuTrigger
			render={
				<Button
					aria-label={`Account menu for ${moderator.name}`}
					className={
						collapsed
							? undefined
							: "w-full min-w-0 justify-start rounded-tag px-2"
					}
					data-account-menu-trigger
					size={collapsed ? "icon" : "default"}
					variant="ghost"
				/>
			}
		>
			<Avatar
				decorative
				name={moderator.name}
				src={moderator.image || undefined}
			/>
			{collapsed ? null : (
				<span className="min-w-0 truncate">{moderator.name}</span>
			)}
		</DropdownMenuTrigger>
	);

	return (
		<>
			<DropdownMenu>
				{collapsed ? (
					<Tooltip>
						<TooltipTrigger render={trigger} />
						<TooltipContent side="right" sideOffset={16} variant="sidebar">
							Account
						</TooltipContent>
					</Tooltip>
				) : (
					trigger
				)}
				<DropdownMenuContent
					align="start"
					className="w-(--popover)"
					collisionAvoidance={KEEP_ABOVE_TRIGGER}
					side="top"
					sideOffset={4}
				>
					{org ? (
						<>
							<DropdownMenuGroup>
								<DropdownMenuLabel
									className="min-h-7"
									data-layout-role="account-menu-section-label"
								>
									Active workspace
								</DropdownMenuLabel>
								<div
									className="mx-0.5 my-1.5 flex min-h-(--menu-item-h) items-center gap-2 rounded-tag px-1.5"
									data-layout-role="account-menu-active-workspace"
								>
									<OrgAvatar hue={org.avatarHue} name={org.name} size="sm" />
									<span className="min-w-0 flex-1 truncate">{org.name}</span>
									<Icon className="ms-auto" icon={Check} />
								</div>
							</DropdownMenuGroup>
							<DropdownMenuSeparator className="-mx-1 my-0" />
						</>
					) : null}
					<DropdownMenuGroup>
						<DropdownMenuLabel
							className="min-h-7"
							data-layout-role="account-menu-section-label"
						>
							Other workspaces
						</DropdownMenuLabel>
						{visible.organizations.length ? (
							<>
								{visible.organizations.map((candidate, index) => (
									<DropdownMenuItem
										className={index === 0 ? "px-1.5" : "mt-0.5 px-1.5"}
										key={candidate.id}
										onClick={() => selectOrganization(candidate.slug)}
									>
										<OrgAvatar
											hue={candidate.avatarHue}
											name={candidate.name}
											size="sm"
										/>
										<span className="min-w-0 flex-1 truncate">
											{candidate.name}
										</span>
									</DropdownMenuItem>
								))}
								{visible.hasMore ? (
									<DropdownMenuItem
										className="mt-0.5 px-1.5"
										onClick={() => setAllOpen(true)}
									>
										<Icon icon={More} />
										Show all
									</DropdownMenuItem>
								) : null}
							</>
						) : null}
						{visible.hasMore ? null : (
							<DropdownMenuItem
								className="mt-0.5 px-1.5"
								onClick={() => setCreateOrgOpen(true)}
							>
								<Icon icon={Add} />
								Create org
							</DropdownMenuItem>
						)}
					</DropdownMenuGroup>
					<DropdownMenuSeparator className="mx-0 my-1.5" />
					<DropdownMenuLinkItem
						className="mx-1.5 min-h-11.5 w-auto px-1.5 py-1"
						render={
							org ? (
								<Link params={{ org: org.slug }} to="/$org/settings/account" />
							) : (
								<Link to="/account" />
							)
						}
					>
						<Avatar
							decorative
							name={moderator.name}
							src={moderator.image || undefined}
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate">{moderator.name}</span>
							{identity ? (
								<span
									className="block truncate"
									data-layout-role="account-menu-identity"
								>
									{identity}
								</span>
							) : null}
						</span>
					</DropdownMenuLinkItem>
					<DropdownMenuItem className="px-1.5" onClick={openFeedback}>
						<Icon icon={Comment} />
						Send feedback
					</DropdownMenuItem>
					<DropdownMenuItem
						className="mt-0.5 px-1.5"
						onClick={() => setTheme(isDark ? "light" : "dark")}
					>
						<Icon icon={isDark ? Light : Dark} />
						{isDark ? "Light theme" : "Dark theme"}
					</DropdownMenuItem>
					<DropdownMenuItem
						className="mt-0.5 px-1.5"
						onClick={() => setSignOutOpen(true)}
						variant="destructive"
					>
						<Icon icon={SignOut} />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
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
			<ConfirmDestructiveDialog
				actionLabel="Sign out"
				description="Your session on this device ends. You'll need to sign in again to use Tripwire."
				onConfirm={() => signOut.mutateAsync()}
				onOpenChange={setSignOutOpen}
				open={signOutOpen}
				pendingLabel="Signing out"
				title="Sign out of Tripwire?"
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

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Choose a workspace</DialogTitle>
					<DialogDescription>
						Switch the dashboard to another workspace.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="p-0">
					<Command className="rounded-none border-0" label="Workspaces" loop>
						<CommandInput
							autoFocus
							onValueChange={setQuery}
							placeholder="Search workspaces"
							value={query}
						/>
						<CommandList className="max-h-none overflow-visible p-0">
							<CommandEmpty>No workspaces match</CommandEmpty>
							<CommandGroup>
								<div className="h-[calc(var(--menu-row)*5+var(--space-2))] scroll-py-1 overflow-y-auto overscroll-contain p-1">
									{shownOrganizations.map((candidate) => (
										<CommandItem
											key={candidate.id}
											keywords={[candidate.slug]}
											onSelect={() => onSelect(candidate.slug)}
											value={candidate.name}
										>
											<OrgAvatar
												hue={candidate.avatarHue}
												name={candidate.name}
												size="default"
											/>
											<CommandLabel>{candidate.name}</CommandLabel>
											{candidate.id === selectedId ? (
												<Icon className="ms-auto" icon={Check} />
											) : null}
										</CommandItem>
									))}
								</div>
								{hasMore ? (
									<CommandItem
										onSelect={revealMoreOrganizations}
										value="View more"
									>
										<Icon icon={ChevronDown} />
										<CommandLabel>View more</CommandLabel>
									</CommandItem>
								) : null}
								<CommandItem onSelect={onCreate} value="Create org">
									<Icon icon={Add} />
									<CommandLabel>Create org</CommandLabel>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</DialogBody>
				<DialogFooter>
					<DialogClose>Close</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
