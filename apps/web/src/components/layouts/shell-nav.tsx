import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import type { OrgRegion } from "@tripwire/contracts";
import { motion, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useRef } from "react";
import {
	Activity,
	Analytics,
	Customize,
	type GlazeIcon,
	Home,
	Moderation,
	Rules,
	Settings,
	Workflow,
} from "#/design-system/icon";
import { cn } from "#/design-system/lib/utils";
import {
	prepareSidebarTransition,
	SidebarNav,
	SidebarNavItemContent,
	SidebarNavTooltip,
	sidebarNavItemClass,
} from "#/design-system/ui/sidebar";
import type { RouteScope } from "#/lib/active-scope";
import { orgContextQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";

type NavVariant = "tabs" | "rail";

export interface NestedNavItem {
	parent: "rules" | "workflows" | "activity" | "moderation";
	label: string;
}

interface ShellNavProps {
	counts: { queue?: number };
	variant?: NavVariant;
	nestedItem?: NestedNavItem;
	scope?: RouteScope;
	collapsed?: boolean;
}

const NAV_CLASS = {
	tabs: "flex h-10 min-w-0 shrink-0 items-stretch gap-5 overflow-x-auto px-4 [scrollbar-width:none]",
} satisfies Record<Exclude<NavVariant, "rail">, string>;

const LINK_CLASS = {
	tabs: "flex shrink-0 items-center gap-1.5 border-transparent border-b-2 pt-0.5 type-label text-text-2 transition-colors duration-(--dur-state) ease-out hover:text-text-1 aria-[current=page]:border-ink aria-[current=page]:text-text-1",
} satisfies Record<Exclude<NavVariant, "rail">, string>;

export function ShellNav({
	counts,
	variant = "tabs",
	nestedItem,
	scope,
	collapsed = false,
}: ShellNavProps) {
	const params = useParams({ strict: false });
	const org = params.org ?? scope?.org;
	const repo = params.repo ?? scope?.repo;
	const reduceMotion = useReducedMotion();
	const navRef = useRef<HTMLElement>(null);
	useActiveLinkInView(navRef);
	const { data: permissions } = useQuery({
		...orgContextQueryOptions(org ?? ""),
		enabled: Boolean(org),
		select: (context) => context.permissions,
	});
	const { data: hasRepos } = useQuery({
		...orgHomeQueryOptions(org ?? ""),
		enabled: Boolean(org) && !repo,
		select: (home) => home.repos.length > 0,
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
		const items = (
			<>
				<NavLink
					icon={Home}
					label="Home"
					to={`/${org}/home`}
					variant={variant}
					collapsed={collapsed}
				/>
				{hasRepos && reads("analytics") ? (
					<NavLink
						exact={false}
						icon={Analytics}
						label="Analytics"
						to={`/${org}/analytics`}
						variant={variant}
						collapsed={collapsed}
					/>
				) : null}
				{variant === "tabs" ? (
					<NavLink
						active={inOrgSettings}
						icon={Settings}
						label="Settings"
						to={`/${org}/settings`}
						variant={variant}
					/>
				) : null}
			</>
		);
		return variant === "rail" ? (
			<SidebarNav
				aria-label="Org"
				className={collapsed ? undefined : "px-1"}
				ref={navRef}
			>
				{items}
			</SidebarNav>
		) : (
			<nav aria-label="Org" ref={navRef} className={NAV_CLASS[variant]}>
				{items}
			</nav>
		);
	}

	let nestedParent = nestedItem?.parent;
	if (nestedParent === "moderation" && !reads("moderation"))
		nestedParent = "activity";
	if (nestedParent === "activity" && !reads("activity"))
		nestedParent = "moderation";

	const repoLink = (
		parent: NestedNavItem["parent"],
		label: string,
		icon: GlazeIcon,
		value?: number,
	) => {
		if (!reads(parent)) return null;
		const child = nestedParent === parent ? nestedItem : undefined;
		return (
			<>
				<NavLink
					active={child ? variant === "tabs" || collapsed : undefined}
					collapsed={collapsed}
					exact={parent !== "moderation"}
					icon={icon}
					label={label}
					to={`/${org}/${repo}/${parent}`}
					value={value}
					variant={variant}
				/>
				{variant === "rail" && child && !collapsed && (
					<motion.div
						animate={{ height: "auto", opacity: 1 }}
						initial={reduceMotion ? false : { height: 0, opacity: 0 }}
						key={pathname}
						transition={
							reduceMotion
								? { duration: 0 }
								: { type: "spring", bounce: 0, duration: 0.23 }
						}
					>
						<NavLink
							active
							icon={parent === "rules" ? Settings : icon}
							label={child.label}
							nested
							to={pathname}
							variant={variant}
						/>
					</motion.div>
				)}
			</>
		);
	};

	const items = (
		<>
			{repoLink("moderation", "Human review", Moderation, counts.queue)}
			{repoLink("activity", "Activity", Activity)}
			{repoLink("rules", "Rules", Rules)}
			{repoLink("workflows", "Workflows", Workflow)}
			{reads("responses") ? (
				<NavLink
					variant={variant}
					icon={Customize}
					label="Responses"
					to={`/${org}/${repo}/responses`}
					collapsed={collapsed}
				/>
			) : null}
			{reads("analytics") ? (
				<NavLink
					variant={variant}
					exact={false}
					icon={Analytics}
					label="Analytics"
					to={`/${org}/${repo}/analytics`}
					collapsed={collapsed}
				/>
			) : null}
		</>
	);
	return variant === "rail" ? (
		<SidebarNav
			aria-label="Repo"
			className={collapsed ? undefined : "px-1"}
			data-feedback-name="ShellNav"
			ref={navRef}
		>
			{items}
		</SidebarNav>
	) : (
		<nav
			aria-label="Repo"
			className={NAV_CLASS[variant]}
			data-feedback-name="ShellNav"
			ref={navRef}
		>
			{items}
		</nav>
	);
}

export function ShellSettingsLink({
	org,
	collapsed = false,
}: {
	org: string | undefined;
	collapsed?: boolean;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });
	if (!org) {
		return null;
	}
	return (
		<NavLink
			active={pathname.startsWith(`/${org}/settings`)}
			collapsed={collapsed}
			icon={Settings}
			label="Settings"
			onClick={() => prepareSidebarTransition("forward")}
			to={`/${org}/settings`}
			variant="rail"
			viewTransition
		/>
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
	nested,
	variant,
	collapsed = false,
	onClick,
	viewTransition,
}: {
	to: string;
	label: string;
	icon: GlazeIcon;
	value?: number;
	exact?: boolean;
	active?: boolean;
	nested?: boolean;
	variant: NavVariant;
	collapsed?: boolean;
	onClick?: () => void;
	viewTransition?: boolean;
}) {
	const link = (
		<Link
			activeOptions={{ exact }}
			activeProps={active === undefined ? { "aria-current": "page" } : {}}
			aria-current={active ? "page" : undefined}
			className={cn(
				variant === "rail"
					? sidebarNavItemClass({ collapsed, nested })
					: LINK_CLASS.tabs,
			)}
			onClick={onClick}
			search={nested ? true : undefined}
			to={to}
			viewTransition={viewTransition}
		>
			{variant === "rail" ? (
				<SidebarNavItemContent
					collapsed={collapsed}
					icon={icon}
					label={label}
					nested={nested}
					value={value}
				/>
			) : null}
			{variant === "tabs" ? (
				<span className="min-w-0 truncate" title={nested ? label : undefined}>
					{label}
				</span>
			) : null}
			{value !== undefined && variant === "tabs" ? (
				<span className={cn("text-text-3 tabular-nums")}>
					{value}
					<span className="sr-only"> to review</span>
				</span>
			) : null}
		</Link>
	);
	return (
		<SidebarNavTooltip collapsed={collapsed} label={label}>
			{link}
		</SidebarNavTooltip>
	);
}
