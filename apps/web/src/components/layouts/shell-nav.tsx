import { Link, useLocation, useParams } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef } from "react";
import {
	Activity,
	Analytics,
	Customize,
	type GlazeIcon,
	Home,
	Icon,
	Moderation,
	Rules,
	Settings,
	Workflow,
} from "#/components/glaze/icon";
import { cn } from "#/lib/glaze/utils";

type NavVariant = "tabs" | "rail";

interface ShellNavProps {
	counts: { queue?: number };
	variant?: NavVariant;
}

const NAV_CLASS = {
	tabs: "flex h-10 min-w-0 shrink-0 items-stretch gap-5 overflow-x-auto border-line-faint border-b px-4 [scrollbar-width:none]",
	rail: "flex min-w-0 flex-col gap-px",
} satisfies Record<NavVariant, string>;

const LINK_CLASS = {
	tabs: "-mb-px flex shrink-0 items-center gap-1.5 border-transparent border-b-2 pt-0.5 type-label text-text-2 transition-colors duration-(--dur-state) ease-out hover:text-text-1 aria-[current=page]:border-ink aria-[current=page]:text-text-1",
	rail: "flex h-(--control) items-center gap-2 rounded-tag px-2 type-label text-text-2 hover:bg-hover hover:text-text-1 aria-[current=page]:bg-pressed aria-[current=page]:text-text-1",
} satisfies Record<NavVariant, string>;

export function ShellNav({ counts, variant = "tabs" }: ShellNavProps) {
	const params = useParams({ strict: false });
	const org = params.org;
	const repo = params.repo;
	const navRef = useRef<HTMLElement>(null);
	useActiveLinkInView(navRef);

	if (!org) {
		return null;
	}

	if (!repo) {
		return (
			<nav aria-label="Org" ref={navRef} className={NAV_CLASS[variant]}>
				<NavLink
					icon={Home}
					label="Home"
					to={`/${org}/home`}
					variant={variant}
				/>
				<NavLink
					exact={false}
					icon={Analytics}
					label="Analytics"
					to={`/${org}/analytics`}
					variant={variant}
				/>
				<NavLink
					activeOptions={{ exact: true, includeSearch: true }}
					icon={Settings}
					label="Settings"
					search={{ settings: "members" }}
					to="."
					variant={variant}
				/>
			</nav>
		);
	}

	return (
		<nav aria-label="Repo" ref={navRef} className={NAV_CLASS[variant]}>
			<NavLink
				variant={variant}
				icon={Moderation}
				label="Moderation"
				to={`/${org}/${repo}/moderation`}
				value={counts.queue}
			/>
			<NavLink
				variant={variant}
				icon={Activity}
				label="Activity"
				to={`/${org}/${repo}/activity`}
			/>
			<NavLink
				icon={Rules}
				label="Rules"
				to={`/${org}/${repo}/rules`}
				variant={variant}
			/>
			<NavLink
				variant={variant}
				icon={Workflow}
				label="Workflows"
				to={`/${org}/${repo}/workflows`}
			/>
			<NavLink
				variant={variant}
				icon={Customize}
				label="Responses"
				to={`/${org}/${repo}/responses`}
			/>
			<NavLink
				variant={variant}
				exact={false}
				icon={Analytics}
				label="Analytics"
				to={`/${org}/${repo}/analytics`}
			/>
		</nav>
	);
}

function useActiveLinkInView(navRef: RefObject<HTMLElement | null>) {
	const pathname = useLocation({ select: (location) => location.pathname });
	useEffect(() => {
		if (!pathname) return;
		const active = navRef.current?.querySelector('[aria-current="page"]');
		active?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [navRef, pathname]);
}

function NavLink({
	to,
	label,
	icon,
	value,
	search,
	exact = true,
	activeOptions,
	variant,
}: {
	to: string;
	label: string;
	icon: GlazeIcon;
	value?: number;
	search?: Record<string, string>;
	exact?: boolean;
	activeOptions?: { exact: boolean; includeSearch?: boolean };
	variant: NavVariant;
}) {
	return (
		<Link
			activeOptions={activeOptions ?? { exact }}
			activeProps={{ "aria-current": "page" }}
			search={search}
			className={LINK_CLASS[variant]}
			to={to}
		>
			{variant === "rail" ? <Icon icon={icon} /> : null}
			<span>{label}</span>
			{typeof value === "number" ? (
				<span
					className={cn(
						"text-text-3 tabular-nums",
						variant === "rail" && "ms-auto",
					)}
				>
					{value}
					<span className="sr-only"> to review</span>
				</span>
			) : null}
		</Link>
	);
}
