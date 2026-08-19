import {
	Comment01Icon,
	Logout01Icon,
	MoonIcon,
	Settings01Icon,
	Sun01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useParams } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { useFeedback } from "#/components/feedback";
import { RepoSwitcher } from "#/components/layouts/repo-switcher";
import { RepoTabBar } from "#/components/tabs";
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
	// URL-scoped nav (§8): the org in the URL decides where the wordmark and the
	// account menu point.
	const params = useParams({ strict: false });
	const org = params.org;

	return (
		<nav
			aria-label="Primary"
			className="flex min-w-0 items-center gap-3 px-3 py-2"
		>
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

			{/* The window's own row: the repos you have open. The page tree for the
			    active one lives inside the page shell (`ShellNav`). */}
			<RepoTabBar className="hidden md:flex" />

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
			<DropdownMenuTrigger
				aria-label="Account"
				className="flex size-8 items-center justify-center rounded-full"
			>
				<Avatar className="size-7">
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
					<DropdownMenuItem
						render={
							// `to="."` — the dialog opens over whatever page you're on.
							<Link
								search={(prev) => ({ ...prev, settings: "members" as const })}
								to="."
							/>
						}
					>
						<HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={2} />
						Settings
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem onClick={openFeedback}>
					<HugeiconsIcon icon={Comment01Icon} size={14} strokeWidth={2} />
					Send feedback
				</DropdownMenuItem>
				<DropdownMenuItem
					className="text-destructive data-highlighted:text-destructive"
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
