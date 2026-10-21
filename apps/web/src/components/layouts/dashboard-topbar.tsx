import { Link } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { useFeedback } from "#/components/feedback";
import {
	Comment,
	Dark,
	Icon,
	Light,
	Settings,
	SignOut,
} from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuLinkItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { RepoSwitcher } from "#/components/layouts/repo-switcher";
import { RepoTabBar } from "#/components/tabs";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useHasMounted } from "#/hooks/use-has-mounted";
import type { CurrentUser } from "#/lib/auth.functions";
import { authClient } from "#/lib/auth-client";
import { siteConfig } from "#/lib/site-config";

interface DashboardTopbarProps {
	user: CurrentUser | null;
}

export function DashboardTopbar({ user }: DashboardTopbarProps) {
	const org = useActiveScope().org?.slug;

	return (
		<>
			<nav
				aria-label="Primary"
				className="flex h-12 min-w-0 shrink-0 items-center gap-3 px-3"
			>
				<Link
					aria-label={org ? "Tripwire, go to org home" : "Tripwire, go to home"}
					to={org ? "/$org/home" : "/"}
					params={org ? { org } : {}}
					className="flex h-(--control) shrink-0 items-center gap-2 rounded-pill px-2 text-text-1 hover:bg-hover"
				>
					<TripwireWordmark height={15} width={24} />
					<span className="type-label">{siteConfig.wordmark}</span>
				</Link>

				<RepoTabBar className="hidden xl:flex" />

				<div className="ms-auto flex min-w-0 items-center">
					<RepoSwitcher />
				</div>

				<div className="flex shrink-0 items-center gap-1">
					<ThemeToggle />
					<UserMenu org={org} user={user} />
				</div>
			</nav>
			<RepoTabBar className="hidden shrink-0 px-3 pb-2 md:flex xl:hidden" />
		</>
	);
}

const PLACEHOLDER_USER: CurrentUser = {
	name: "local session",
	login: "dev",
	email: null,
	image: "",
};

function UserMenu({ org, user }: { org?: string; user: CurrentUser | null }) {
	const moderator = user ?? PLACEHOLDER_USER;
	const identity = accountIdentity(moderator);
	const { open: openFeedback } = useFeedback();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`Account menu for ${moderator.name}`}
						size="icon"
						variant="ghost"
					/>
				}
			>
				<Avatar
					decorative
					name={moderator.name}
					src={moderator.image || undefined}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="min-w-(--menu-min) max-w-popover"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex-col items-start justify-center gap-0.5 py-1.5">
						<span className="max-w-full truncate type-label text-text-1">
							{moderator.name}
						</span>
						{identity ? (
							<span className="max-w-full truncate type-caption text-text-2">
								{identity}
							</span>
						) : null}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				{org ? (
					<DropdownMenuLinkItem
						render={
							<Link
								search={(prev) => ({ ...prev, settings: "members" as const })}
								to="."
							/>
						}
					>
						<Icon icon={Settings} />
						Open org settings
					</DropdownMenuLinkItem>
				) : null}
				<DropdownMenuItem onClick={openFeedback}>
					<Icon icon={Comment} />
					Send feedback
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() =>
						authClient.signOut({
							fetchOptions: {
								onSuccess: () => window.location.assign("/login"),
							},
						})
					}
				>
					<Icon icon={SignOut} />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function accountIdentity(user: CurrentUser): string | null {
	if (user.email) {
		return user.email;
	}
	if (user.login && user.login !== user.name) {
		return `@${user.login}`;
	}
	return null;
}

function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = hasMounted && resolvedTheme === "dark";

	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
			onClick={() => setTheme(isDark ? "light" : "dark")}
		>
			<Icon icon={isDark ? Light : Dark} />
		</Button>
	);
}
