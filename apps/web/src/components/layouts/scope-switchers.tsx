import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command, type CommandEntry } from "@tripwire/ui/command";
import { Add, ChevronSort, Icon, Settings } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { Popover } from "@tripwire/ui/popover";
import { type ComponentPropsWithRef, type ReactNode, useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { CreateOrgDialog } from "#/components/organizations/create-org-dialog";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useFeaturePath } from "#/hooks/use-feature-path";
import { useOrgSwitchPath } from "#/hooks/use-org-switch-path";
import { myOrgsQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";
import { duplicateRepoNames, qualifiedRepoLabel } from "#/lib/repo-label";
import { repoRouteKey } from "#/lib/repo-route";

type Appearance = "bar" | "rail";

interface ScopeSwitcherTriggerProps
	extends Omit<ComponentPropsWithRef<"button">, "children" | "className"> {
	appearance: Appearance;
	icon?: ReactNode;
	label: string;
	muted?: boolean;
	reserveIcon?: boolean;
}

export function ScopeSwitcherTrigger({
	appearance,
	icon,
	label,
	muted = false,
	reserveIcon = false,
	ref,
	type = "button",
	...buttonProps
}: ScopeSwitcherTriggerProps) {
	return (
		<button
			{...buttonProps}
			data-appearance={appearance}
			data-layout-role="scope-switcher-trigger"
			ref={ref}
			type={type}
		>
			{icon || reserveIcon ? (
				<span data-layout-role="scope-switcher-icon">{icon}</span>
			) : null}
			<span
				data-layout-role="scope-switcher-label"
				data-muted={muted ? "" : undefined}
			>
				{label}
			</span>
			<span data-layout-role="scope-switcher-chevron">
				<Icon icon={ChevronSort} tone="tertiary" />
			</span>
		</button>
	);
}

export function OrgSwitcher({
	appearance = "bar",
}: {
	appearance?: Appearance;
}) {
	const { org } = useActiveScope();
	const navigate = useNavigate();
	const orgSwitchPath = useOrgSwitchPath();
	const [creating, setCreating] = useState(false);
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const items: MenuEntry[] = [
		...(orgs ?? []).map(
			(candidate): MenuEntry => ({
				icon: (
					<OrgAvatar
						hue={candidate.avatarHue}
						name={candidate.name}
						size="sm"
					/>
				),
				badge: candidate.isPersonal ? { label: "Personal" } : undefined,
				current: candidate.id === org?.id,
				label: candidate.name,
				onAction: () => navigate({ to: orgSwitchPath(candidate.slug) }),
				value: `org:${candidate.id}`,
			}),
		),
		{ type: "separator", value: "org-actions" },
		{
			icon: <Icon icon={Add} />,
			label: "Create org",
			onAction: () => setCreating(true),
			value: "create-org",
		},
		...(org
			? [
					{
						href: `/${org.slug}/settings`,
						icon: <Icon icon={Settings} />,
						label: "Org settings",
						type: "link" as const,
						value: "org-settings",
					},
				]
			: []),
	];

	return (
		<>
			<Menu
				align="start"
				ariaLabel={org ? `Org: ${org.name}. Switch org` : "Switch org"}
				items={items}
				placement={appearance === "rail" ? "right" : "bottom"}
				trigger={
					<ScopeSwitcherTrigger
						appearance={appearance}
						aria-label={org ? `Org: ${org.name}. Switch org` : "Switch org"}
						icon={
							org ? (
								<OrgAvatar hue={org.avatarHue} name={org.name} size="sm" />
							) : undefined
						}
						label={org?.name ?? "Pick an org"}
					/>
				}
			/>
			<CreateOrgDialog
				onCreated={(slug) => {
					setCreating(false);
					navigate({ to: "/$org/home", params: { org: slug } });
				}}
				onOpenChange={setCreating}
				open={creating}
			/>
		</>
	);
}

export function RepoSwitcher({
	appearance = "bar",
}: {
	appearance?: Appearance;
}) {
	const { org, repo, repoCandidate, repoForge } = useActiveScope();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const featurePath = useFeaturePath(org?.slug, repo ?? undefined);
	const { data: home } = useQuery({
		...orgHomeQueryOptions(org?.slug ?? ""),
		enabled: Boolean(org),
	});
	const repos = [...(home?.repos ?? [])].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const duplicateNames = duplicateRepoNames(repos);
	const current = repos.find(
		(candidate) => repoRouteKey(candidate) === repo || candidate.name === repo,
	);
	const currentForge = current?.forge ?? repoForge;
	const triggerRepo = current
		? duplicateNames.has(current.name)
			? qualifiedRepoLabel(current)
			: current.name
		: repoCandidate;
	const commandItems: CommandEntry[] = [
		{
			items: repos.map((candidate) => {
				const routeRepo = repoRouteKey(candidate);
				return {
					badge: candidate.armed ? undefined : "Off",
					current: routeRepo === repo || candidate.name === repo,
					icon: <ForgeMark className="shrink-0" forge={candidate.forge} />,
					keywords: [candidate.owner, candidate.fullName],
					label: duplicateNames.has(candidate.name)
						? qualifiedRepoLabel(candidate)
						: candidate.name,
					onAction: () => {
						setOpen(false);
						navigate({ to: `/${org?.slug}/${routeRepo}${featurePath}` });
					},
					value: routeRepo,
				};
			}),
			label: "Repos",
			showLabel: false,
			type: "group",
		},
		{ id: "repo-actions", type: "separator" },
		{
			items: [
				{
					icon: <Icon icon={Add} />,
					label: "Connect repos",
					onAction: () => {
						setOpen(false);
						setConnecting(true);
					},
					value: "connect-repos",
				},
			],
			label: "Actions",
			showLabel: false,
			type: "group",
		},
	];

	if (!org) {
		return null;
	}

	return (
		<>
			<div data-appearance={appearance} data-layout-role="repo-switcher-slot">
				<Popover
					align="start"
					onOpenChange={setOpen}
					open={open}
					placement={appearance === "rail" ? "right" : "bottom"}
					variant="menu"
					trigger={
						<ScopeSwitcherTrigger
							appearance={appearance}
							aria-label={
								triggerRepo
									? `Repo: ${triggerRepo}. Switch repo`
									: "Pick a repo"
							}
							icon={
								currentForge ? (
									<ForgeMark className="shrink-0" forge={currentForge} />
								) : undefined
							}
							label={triggerRepo ?? "Pick a repo"}
							muted={!triggerRepo}
							reserveIcon={Boolean(repoCandidate)}
						/>
					}
					triggerLabel={
						triggerRepo ? `Repo: ${triggerRepo}. Switch repo` : "Pick a repo"
					}
				>
					<Command
						ariaLabel="Repos"
						autoFocus
						emptyLabel="No repos match"
						items={commandItems}
						placeholder="Find a repo"
					/>
				</Popover>
			</div>
			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org.slug}
			/>
		</>
	);
}
