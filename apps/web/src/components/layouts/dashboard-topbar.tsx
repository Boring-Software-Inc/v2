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
} from "#/design-system/icon";
import { Avatar } from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
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
import { useActiveScope } from "#/hooks/use-active-scope";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { useSignOut } from "#/hooks/use-sign-out";
import type { CurrentUser } from "#/lib/auth.functions";

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

const PLACEHOLDER_USER: CurrentUser = {
	id: "",
	name: "local session",
	login: "dev",
	forgeLogin: null,
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
	const signOut = useSignOut();
	const moderator = user ?? PLACEHOLDER_USER;
	const identity = accountIdentity(moderator);
	const { start: openFeedback } = useFeedback();
	const { resolvedTheme, setTheme } = useTheme();
	const hasMounted = useHasMounted();
	const isDark = hasMounted && resolvedTheme === "dark";
	const org = useActiveScope().org?.slug;
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
					size={showName ? "default" : "lg"}
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
				<DropdownMenuLinkItem
					render={
						org ? (
							<Link params={{ org }} to="/$org/settings/account" />
						) : (
							<Link to="/account" />
						)
					}
				>
					<Icon icon={Settings} />
					Account settings
				</DropdownMenuLinkItem>
				<DropdownMenuItem onClick={openFeedback}>
					<Icon icon={Comment} />
					Send feedback
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
					<Icon icon={isDark ? Light : Dark} />
					{isDark ? "Light theme" : "Dark theme"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => signOut.mutate()}>
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
