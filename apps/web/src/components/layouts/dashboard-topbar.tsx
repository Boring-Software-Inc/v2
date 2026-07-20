import {
	ActivityIcon,
	Analytics01Icon,
	CheckListIcon,
	Comment01Icon,
	FlowIcon,
	Logout01Icon,
	MoonIcon,
	Queue01Icon,
	Settings01Icon,
	Sun01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useParams } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { useFeedback } from "#/components/feedback";
import { RepoSwitcher } from "#/components/layouts/repo-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useHasMounted } from "#/hooks/use-has-mounted";
import type { CurrentUser } from "#/lib/auth.functions";
import { authClient } from "#/lib/auth-client";
import { siteConfig } from "#/lib/site-config";

interface DashboardTopbarProps {
	/** The signed-in maintainer; null in open-dev or signed out (§10). */
	user: CurrentUser | null;
}

export function DashboardTopbar({ user }: DashboardTopbarProps) {
	// URL-scoped nav (§8): the org (and repo) in the URL decide the link tree.
	const params = useParams({ strict: false });
	const org = params.org;
	const repo = params.repo;

	return (
		<nav className="flex min-w-0 items-center gap-3 px-3 py-2">
			{/* The logo goes home — the only route back to the org level from a repo. */}
			<Link
				to={org ? "/$org/home" : "/"}
				params={org ? { org } : {}}
				className="flex shrink-0 items-center gap-2 rounded-md pr-1 pl-1 transition-colors hover:bg-surface-0"
			>
				<TripwireWordmark className="text-foreground" height={15} width={24} />
				<span className="text-sm font-medium tracking-tight">
					{siteConfig.name}
				</span>
			</Link>

			{/* The repo page tree lives inline with the logo. Org-level pages (Home)
			    keep their nav in the page body, so the topbar stays bare there. */}
			{org && repo ? (
				<div className="hidden shrink-0 items-center gap-0.5 md:flex">
					<NavLink
						to={`/${org}/${repo}/moderation`}
						label="Moderation"
						icon={Queue01Icon}
					/>
					<NavLink
						to={`/${org}/${repo}/activity`}
						label="Activity"
						icon={ActivityIcon}
					/>
					<NavLink
						to={`/${org}/${repo}/rules`}
						label="Rules"
						icon={CheckListIcon}
					/>
					<NavLink
						to={`/${org}/${repo}/workflows`}
						label="Workflows"
						icon={FlowIcon}
					/>
					<NavLink
						to={`/${org}/${repo}/analytics`}
						label="Analytics"
						icon={Analytics01Icon}
						exact={false}
					/>
				</div>
			) : null}

			<div className="ml-auto hidden items-center md:flex">
				<RepoSwitcher />
			</div>

			<div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
				<ThemeToggle />
				<UserMenu org={org} user={user} />
			</div>
		</nav>
	);
}

/** Placeholder identity for open-dev / signed-out — never a fabricated name. */
const PLACEHOLDER_USER: CurrentUser = {
	name: "local session",
	login: "dev",
	image: "",
};

function UserMenu({ org, user }: { org?: string; user: CurrentUser | null }) {
	const moderator = user ?? PLACEHOLDER_USER;
	const { open: openFeedback } = useFeedback();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="flex size-8 items-center justify-center rounded-full"
					aria-label="Account"
				>
					<Avatar className="size-7 border border-border">
						<AvatarImage
							src={moderator.image ?? undefined}
							alt={moderator.name}
						/>
						<AvatarFallback className="text-xs">
							{moderator.name
								.split(" ")
								.map((part) => part[0])
								.join("")
								.slice(0, 2)
								.toUpperCase()}
						</AvatarFallback>
					</Avatar>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel className="flex flex-col gap-0.5">
					<span className="font-medium">{moderator.name}</span>
					<span className="text-xs text-muted-foreground">
						@{moderator.login}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{org ? (
					<DropdownMenuItem asChild>
						{/* `to="."` — the dialog opens over whatever page you're on. */}
						<Link
							search={(prev) => ({ ...prev, settings: "members" as const })}
							to="."
						>
							<HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={2} />
							Settings
						</Link>
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem onClick={openFeedback}>
					<HugeiconsIcon icon={Comment01Icon} size={14} strokeWidth={2} />
					Send feedback
				</DropdownMenuItem>
				<DropdownMenuItem
					className="text-destructive focus:text-destructive"
					onClick={() =>
						authClient.signOut({
							fetchOptions: {
								onSuccess: () => window.location.assign("/login"),
							},
						})
					}
				>
					<HugeiconsIcon icon={Logout01Icon} size={14} strokeWidth={2} />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NavLink({
	to,
	label,
	icon,
	exact = true,
}: {
	to: string;
	label: string;
	icon: IconSvgElement;
	exact?: boolean;
}) {
	return (
		<Link
			to={to}
			activeOptions={{ exact }}
			activeProps={{ className: "active" }}
			className="flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-0 hover:text-foreground [&.active]:bg-surface-0 [&.active]:text-foreground"
		>
			<HugeiconsIcon icon={icon} size={14} strokeWidth={2} />
			<span>{label}</span>
		</Link>
	);
}

function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = resolvedTheme === "dark";

	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label="Toggle theme"
			className="size-8 text-muted-foreground hover:bg-surface-1"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			iconLeft={
				hasMounted && isDark ? (
					<HugeiconsIcon icon={Sun01Icon} size={16} strokeWidth={2} />
				) : (
					<HugeiconsIcon icon={MoonIcon} size={16} strokeWidth={2} />
				)
			}
		/>
	);
}
