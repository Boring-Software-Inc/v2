import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import {
	Add,
	Check,
	ChevronSort,
	Icon,
	Settings,
} from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "#/components/glaze/ui/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLinkItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { CreateOrgDialog } from "#/components/organizations/create-org-dialog";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useFeaturePath } from "#/hooks/use-feature-path";
import { cn } from "#/lib/glaze/utils";
import { myOrgsQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";

type Appearance = "bar" | "rail";

const TRIGGER = {
	bar: "min-w-0 max-w-64 shrink max-sm:min-w-fit",
	rail: "w-full min-w-0 justify-start",
} satisfies Record<Appearance, string>;

export function OrgSwitcher({
	appearance = "bar",
}: {
	appearance?: Appearance;
}) {
	const { org } = useActiveScope();
	const navigate = useNavigate();
	const [creating, setCreating] = useState(false);
	const { data: orgs } = useQuery(myOrgsQueryOptions());

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={org ? `Org: ${org.name}. Switch org` : "Switch org"}
							className={TRIGGER[appearance]}
							variant="ghost"
						/>
					}
				>
					{org ? (
						<OrgAvatar eyes hue={org.avatarHue} name={org.name} size="sm" />
					) : null}
					<span
						className={cn(
							"min-w-0 truncate",
							appearance === "bar" && "max-sm:hidden",
						)}
					>
						{org?.name ?? "Pick an org"}
					</span>
					<Icon
						className={cn(
							"shrink-0 text-text-3",
							appearance === "rail" && "ms-auto",
						)}
						icon={ChevronSort}
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="min-w-64"
					side={appearance === "rail" ? "right" : "bottom"}
				>
					{orgs?.map((candidate) => (
						<DropdownMenuItem
							key={candidate.id}
							onClick={() =>
								navigate({ to: "/$org/home", params: { org: candidate.slug } })
							}
						>
							<OrgAvatar
								hue={candidate.avatarHue}
								name={candidate.name}
								size="sm"
							/>
							<span className="min-w-0 flex-1 truncate">{candidate.name}</span>
							{candidate.isPersonal ? (
								<span className="type-caption text-text-3">Personal</span>
							) : null}
							{candidate.id === org?.id ? <Icon icon={Check} /> : null}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => setCreating(true)}>
						<Icon icon={Add} />
						Create org
					</DropdownMenuItem>
					{org ? (
						<DropdownMenuLinkItem
							render={<Link params={{ org: org.slug }} to="/$org/settings" />}
						>
							<Icon icon={Settings} />
							Org settings
						</DropdownMenuLinkItem>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
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
	const { org, repo } = useActiveScope();
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
	const current = repos.find((candidate) => candidate.name === repo);

	if (!org) {
		return null;
	}

	return (
		<>
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger
					render={
						<Button
							aria-label={repo ? `Repo: ${repo}. Switch repo` : "Pick a repo"}
							className={TRIGGER[appearance]}
							variant="ghost"
						/>
					}
				>
					{current ? (
						<ForgeMark className="shrink-0" forge={current.forge} />
					) : null}
					<span
						className={cn(
							"min-w-0 truncate",
							!repo && "text-text-2",
							appearance === "bar" && "max-sm:hidden",
						)}
					>
						{repo ?? "Pick a repo"}
					</span>
					<Icon
						className={cn(
							"shrink-0 text-text-3",
							appearance === "rail" && "ms-auto",
						)}
						icon={ChevronSort}
					/>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="p-0"
					side={appearance === "rail" ? "right" : "bottom"}
				>
					<Command label="Repos" loop>
						<CommandInput autoFocus placeholder="Find a repo" />
						<CommandList>
							<CommandEmpty>No repos match</CommandEmpty>
							<CommandGroup>
								{repos.map((candidate) => (
									<CommandItem
										key={candidate.id}
										keywords={[candidate.owner, candidate.fullName]}
										onSelect={() => {
											setOpen(false);
											navigate({
												to: `/${org.slug}/${candidate.name}${featurePath}`,
											});
										}}
										value={candidate.name}
									>
										<ForgeMark className="shrink-0" forge={candidate.forge} />
										<span className="min-w-0 flex-1 truncate">
											{candidate.name}
										</span>
										{candidate.armed ? null : (
											<span className="type-caption text-text-3">Off</span>
										)}
										{candidate.name === repo ? <Icon icon={Check} /> : null}
									</CommandItem>
								))}
							</CommandGroup>
							<CommandSeparator alwaysRender />
							<CommandGroup>
								<CommandItem
									forceMount
									onSelect={() => {
										setOpen(false);
										setConnecting(true);
									}}
									value="Connect repos"
								>
									<Icon icon={Add} />
									Connect repos
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			<ConnectForgeDialog
				onOpenChange={setConnecting}
				open={connecting}
				org={org.slug}
			/>
		</>
	);
}
