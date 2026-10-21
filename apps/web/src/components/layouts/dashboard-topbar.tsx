import { Link } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { useFeedback } from "#/components/feedback";
import { Comment, Dark, Icon, Light, SignOut } from "#/components/glaze/icon";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import { CommandPaletteButton } from "#/components/layouts/command-palette-launcher";
import {
	OrgSwitcher,
	RepoSwitcher,
} from "#/components/layouts/scope-switchers";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useHasMounted } from "#/hooks/use-has-mounted";
import type { CurrentUser } from "#/lib/auth.functions";
import { authClient } from "#/lib/auth-client";

interface DashboardTopbarProps {
	user: CurrentUser | null;
}

export function DashboardTopbar({ user }: DashboardTopbarProps) {
	const org = useActiveScope().org?.slug;

	return (
		<nav
			aria-label="Primary"
			className="flex h-12 min-w-0 shrink-0 items-center gap-1 px-3"
		>
			<Brand org={org} />
			<Slash />
			<OrgSwitcher />
			{org ? (
				<>
					<Slash />
					<RepoSwitcher />
				</>
			) : null}
			<div className="ms-auto flex shrink-0 items-center gap-2">
				<CommandPaletteButton />
				<BetaTag />
				<UserMenu user={user} />
			</div>
		</nav>
	);
}

function Slash() {
	return (
		<span aria-hidden className="type-body text-text-3">
			/
		</span>
	);
}

export function Brand({ org }: { org: string | undefined }) {
	return (
		<Link
			aria-label={org ? "Tripwire, go to org home" : "Tripwire, go to home"}
			className="flex h-(--control) shrink-0 items-center rounded-pill px-2 text-text-1 hover:bg-hover"
			params={org ? { org } : {}}
			to={org ? "/$org/home" : "/"}
		>
			<TripwireWordmark height={15} width={24} />
		</Link>
	);
}

export function BetaTag() {
	const { open: openFeedback } = useFeedback();
	return (
		<Button
			aria-label="Tripwire is in beta. Send feedback"
			onClick={openFeedback}
			size="sm"
			variant="secondary"
		>
			Beta
		</Button>
	);
}

const PLACEHOLDER_USER: CurrentUser = {
	name: "local session",
	login: "dev",
	email: null,
	image: "",
};

export function UserMenu({
	user,
	showName = false,
}: {
	user: CurrentUser | null;
	showName?: boolean;
}) {
	const moderator = user ?? PLACEHOLDER_USER;
	const identity = accountIdentity(moderator);
	const { open: openFeedback } = useFeedback();
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = hasMounted && resolvedTheme === "dark";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`Account menu for ${moderator.name}`}
						className={showName ? "w-full min-w-0 justify-start" : undefined}
						size={showName ? "default" : "icon"}
						variant="ghost"
					/>
				}
			>
				<Avatar
					decorative
					name={moderator.name}
					src={moderator.image || undefined}
				/>
				{showName ? (
					<span className="min-w-0 truncate">{moderator.name}</span>
				) : null}
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
				<DropdownMenuItem onClick={openFeedback}>
					<Icon icon={Comment} />
					Send feedback
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
					<Icon icon={isDark ? Light : Dark} />
					{isDark ? "Light theme" : "Dark theme"}
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
