import {
	ActivityIcon,
	Analytics01Icon,
	Logout01Icon,
	MoonIcon,
	Queue01Icon,
	Search01Icon,
	Settings01Icon,
	Shield01Icon,
	Sun01Icon,
	UserIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useTheme } from "next-themes";
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
import { Input } from "#/components/ui/input";
import { useHasMounted } from "#/hooks/use-has-mounted";
import { siteConfig } from "#/lib/site-config";

interface DashboardTopbarProps {
	moderator: {
		name: string;
		login: string;
		image: string;
	};
	counts: {
		queue?: number;
		automod?: number;
	};
}

export function DashboardTopbar({ moderator, counts }: DashboardTopbarProps) {
	return (
		<nav className="flex min-w-0 items-center gap-3 px-3 py-2">
			<div className="flex shrink-0 items-center gap-2 pl-1 pr-1">
				<span className="font-pixel text-sm font-medium tracking-tight">
					{siteConfig.name}
				</span>
			</div>

			<div className="hidden shrink-0 items-center gap-0.5 md:flex">
				<NavLink to="/" label="Queue" icon={Queue01Icon} value={counts.queue} />
				<NavLink to="/events" label="Events" icon={ActivityIcon} />
				<NavLink
					to="/automod"
					label="Automod"
					icon={Shield01Icon}
					value={counts.automod}
				/>
				<NavLink
					to="/acme/tripwire/analytics"
					label="Analytics"
					icon={Analytics01Icon}
					exact={false}
				/>
				<NavLink
					to="/acme/integrations/github"
					label="Integrations"
					icon={Wrench01Icon}
				/>
			</div>

			<div className="relative ml-auto hidden w-full max-w-xs items-center md:flex">
				<HugeiconsIcon
					icon={Search01Icon}
					size={14}
					strokeWidth={2}
					className="pointer-events-none absolute left-2.5 text-muted-foreground"
				/>
				<Input
					type="search"
					placeholder="Search reports…"
					className="h-8 bg-surface-1 pl-8 text-[13px]"
				/>
			</div>

			<div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
				<ThemeToggle />
				<UserMenu moderator={moderator} />
			</div>
		</nav>
	);
}

function UserMenu({
	moderator,
}: {
	moderator: DashboardTopbarProps["moderator"];
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="flex size-8 items-center justify-center rounded-full"
					aria-label="Account"
				>
					<Avatar className="size-7 border border-border">
						<AvatarImage src={moderator.image} alt={moderator.name} />
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
				<DropdownMenuItem asChild>
					<Link
						to="/profile/$userHandle"
						params={{ userHandle: moderator.login }}
					>
						<HugeiconsIcon icon={UserIcon} size={14} strokeWidth={2} />
						Profile
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem>
					<HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={2} />
					Settings
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem className="text-destructive focus:text-destructive">
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
	value,
	icon,
	exact = true,
}: {
	to: string;
	label: string;
	value?: number;
	icon: IconSvgElement;
	exact?: boolean;
}) {
	return (
		<Link
			to={to}
			activeOptions={{ exact }}
			className="flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-0 hover:text-foreground [&.active]:bg-surface-0 [&.active]:text-foreground"
			activeProps={{ className: "active" }}
		>
			<HugeiconsIcon icon={icon} size={14} strokeWidth={2} />
			<span>{label}</span>
			{typeof value === "number" ? (
				<span className="tabular-nums text-muted-foreground">{value}</span>
			) : null}
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
