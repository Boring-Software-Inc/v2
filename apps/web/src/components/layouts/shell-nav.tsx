import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import type { OrgRegion } from "@tripwire/contracts";
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
import { orgContextQueryOptions } from "#/lib/org.query";

type NavVariant = "tabs" | "rail";

interface ShellNavProps {
	counts: { queue?: number };
	variant?: NavVariant;
}

const NAV_CLASS = {
	tabs: "flex h-10 min-w-0 shrink-0 items-stretch gap-5 overflow-x-auto px-4 [scrollbar-width:none]",
	rail: "flex min-w-0 flex-col gap-px",
} satisfies Record<NavVariant, string>;

const LINK_CLASS = {
	tabs: "flex shrink-0 items-center gap-1.5 border-transparent border-b-2 pt-0.5 type-label text-text-2 transition-colors duration-(--dur-state) ease-out hover:text-text-1 aria-[current=page]:border-ink aria-[current=page]:text-text-1",
	rail: "flex h-(--control) items-center gap-2 rounded-tag px-2 type-label text-text-2 hover:bg-hover hover:text-text-1 aria-[current=page]:bg-pressed aria-[current=page]:text-text-1",
} satisfies Record<NavVariant, string>;

export function ShellNav({ counts, variant = "tabs" }: ShellNavProps) {
	const params = useParams({ strict: false });
	const org = params.org;
	const repo = params.repo;
	const navRef = useRef<HTMLElement>(null);
	useActiveLinkInView(navRef);
	const { data: permissions } = useQuery({
		...orgContextQueryOptions(org ?? ""),
		enabled: Boolean(org),
		select: (context) => context.permissions,
	});
	const pathname = useLocation({ select: (location) => location.pathname });
	const inOrgSettings =
		pathname.startsWith(`/${org}/settings`) &&
		!pathname.startsWith(`/${org}/settings/account`);
	const reads = (region: OrgRegion) =>
		permissions?.includes(`${region}:read`) ?? false;

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
				{reads("analytics") ? (
					<NavLink
						exact={false}
						icon={Analytics}
						label="Analytics"
						to={`/${org}/analytics`}
						variant={variant}
					/>
				) : null}
				<NavLink
					active={inOrgSettings}
					icon={Settings}
					label="Settings"
					to={`/${org}/settings`}
					variant={variant}
				/>
			</nav>
		);
	}

	return (
		<nav
			aria-label="Repo"
			className={NAV_CLASS[variant]}
			data-feedback-name="ShellNav"
			ref={navRef}
		>
			{reads("moderation") ? (
				<NavLink
					exact={false}
					variant={variant}
					icon={Moderation}
					label="Human review"
					to={`/${org}/${repo}/moderation`}
					value={counts.queue}
				/>
			) : null}
			{reads("activity") ? (
				<NavLink
					variant={variant}
					icon={Activity}
					label="Activity"
					to={`/${org}/${repo}/activity`}
				/>
			) : null}
			{reads("rules") ? (
				<NavLink
					icon={Rules}
					label="Rules"
					to={`/${org}/${repo}/rules`}
					variant={variant}
				/>
			) : null}
			{reads("workflows") ? (
				<NavLink
					variant={variant}
					icon={Workflow}
					label="Workflows"
					to={`/${org}/${repo}/workflows`}
				/>
			) : null}
			{reads("responses") ? (
				<NavLink
					variant={variant}
					icon={Customize}
					label="Responses"
					to={`/${org}/${repo}/responses`}
				/>
			) : null}
			{reads("analytics") ? (
				<NavLink
					variant={variant}
					exact={false}
					icon={Analytics}
					label="Analytics"
					to={`/${org}/${repo}/analytics`}
				/>
			) : null}
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
	exact = true,
	active,
	variant,
}: {
	to: string;
	label: string;
	icon: GlazeIcon;
	value?: number;
	exact?: boolean;
	active?: boolean;
	variant: NavVariant;
}) {
	return (
		<Link
			activeOptions={{ exact }}
			activeProps={active === undefined ? { "aria-current": "page" } : {}}
			aria-current={active ? "page" : undefined}
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
