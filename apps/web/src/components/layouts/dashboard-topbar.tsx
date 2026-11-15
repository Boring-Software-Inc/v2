import { Link } from "@tanstack/react-router";
import { Avatar } from "@tripwire/ui/avatar";
import { Button } from "@tripwire/ui/button";
import {
	Comment,
	Dark,
	Icon,
	Light,
	Settings,
	SignOut,
} from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { useTheme } from "next-themes";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { useFeedback } from "#/components/feedback";
import { CommandPaletteButton } from "#/components/layouts/command-palette-launcher";
import { HeaderFeedbackControl } from "#/components/layouts/header-feedback-control";
import {
	OrgSwitcher,
	RepoSwitcher,
} from "#/components/layouts/scope-switchers";
import { SetupPill } from "#/components/setup/setup-pill";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { useSignOut } from "#/hooks/use-sign-out";
import type { CurrentUser } from "#/lib/auth.functions";
import { accountIdentity, PLACEHOLDER_USER } from "#/lib/current-user";

interface DashboardTopbarProps {
	user: CurrentUser | null;
}

export function DashboardTopbar({ user }: DashboardTopbarProps) {
	const scope = useActiveScope();
	const org = scope.org?.slug;

	return (
		<nav
			aria-label="Primary"
			data-feedback-name="DashboardTopbar"
			className="flex h-12 min-w-0 shrink-0 items-center composition-gap-small px-2 sm:composition-inline-inset"
		>
			<Brand org={org} />
			<Slash />
			<OrgSwitcher />
			{org ? (
				<>
					<Slash />
					<RepoSwitcher />
					{scope.repo ? <SetupPill /> : null}
				</>
			) : null}
			<div className="composition-push-end flex min-w-0 items-center composition-gap-small sm:composition-gap-standard">
				<CommandPaletteButton />
				<HeaderFeedbackControl />
				<UserMenu user={user} />
			</div>
		</nav>
	);
}

function Slash() {
	return (
		<span aria-hidden className="content-body tone-content-tertiary">
			/
		</span>
	);
}

export function Brand({ org }: { org: string | undefined }) {
	return (
		<Link
			aria-label={org ? "Tripwire, go to org home" : "Tripwire, go to home"}
			className="flex h-(--control) shrink-0 items-center rounded-pill px-2 tone-content-primary interactive-hover"
			params={org ? { org } : {}}
			to={org ? "/$org/home" : "/"}
		>
			<TripwireWordmark height={15} width={24} />
		</Link>
	);
}

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
	const items: MenuEntry[] = [
		{
			description: identity ?? undefined,
			label: moderator.name,
			type: "summary",
			value: "identity",
		},
		{ type: "separator", value: "identity-separator" },
		{
			href: org ? `/${org}/settings/account` : "/account",
			icon: <Icon icon={Settings} />,
			label: "Account settings",
			type: "link",
			value: "account-settings",
		},
		{
			icon: <Icon icon={Comment} />,
			label: "Send feedback",
			onAction: openFeedback,
			value: "send-feedback",
		},
		{
			icon: <Icon icon={isDark ? Light : Dark} />,
			label: isDark ? "Light theme" : "Dark theme",
			onAction: () => setTheme(isDark ? "light" : "dark"),
			value: "toggle-theme",
		},
		{ type: "separator", value: "sign-out-separator" },
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
			tone: "destructive",
			value: "sign-out",
		},
	];
	return (
		<Menu
			align="end"
			ariaLabel={`Account menu for ${moderator.name}`}
			items={items}
			trigger={
				<Button
					ariaLabel={`Account menu for ${moderator.name}`}
					size={showName ? "medium" : "small"}
					variant="ghost"
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
				</Button>
			}
		/>
	);
}
