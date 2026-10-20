import { Link, useParams } from "@tanstack/react-router";
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

interface ShellNavProps {
	counts: { queue?: number };
}

export function ShellNav({ counts }: ShellNavProps) {
	const params = useParams({ strict: false });
	const org = params.org;
	const repo = params.repo;

	if (!org) {
		return null;
	}

	if (!repo) {
		return (
			<nav
				aria-label="Org"
				className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto px-3 py-2"
			>
				<NavLink icon={Home} label="Home" to={`/${org}/home`} />
				<NavLink
					exact={false}
					icon={Analytics}
					label="Analytics"
					to={`/${org}/analytics`}
				/>
				<NavLink
					activeOptions={{ exact: true, includeSearch: true }}
					icon={Settings}
					label="Settings"
					search={{ settings: "members" }}
					to="."
				/>
			</nav>
		);
	}

	return (
		<nav
			aria-label="Repo"
			className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto px-3 py-2"
		>
			<NavLink
				icon={Moderation}
				label="Moderation"
				to={`/${org}/${repo}/moderation`}
				value={counts.queue}
			/>
			<NavLink
				icon={Activity}
				label="Activity"
				to={`/${org}/${repo}/activity`}
			/>
			<NavLink icon={Rules} label="Rules" to={`/${org}/${repo}/rules`} />
			<NavLink
				icon={Workflow}
				label="Workflows"
				to={`/${org}/${repo}/workflows`}
			/>
			<NavLink
				icon={Customize}
				label="Customize"
				to={`/${org}/${repo}/customize`}
			/>
			<NavLink
				exact={false}
				icon={Analytics}
				label="Analytics"
				to={`/${org}/${repo}/analytics`}
			/>
		</nav>
	);
}

function NavLink({
	to,
	label,
	icon,
	value,
	search,
	exact = true,
	activeOptions,
}: {
	to: string;
	label: string;
	icon: GlazeIcon;
	value?: number;
	search?: Record<string, string>;
	exact?: boolean;
	activeOptions?: { exact: boolean; includeSearch?: boolean };
}) {
	return (
		<Link
			activeOptions={activeOptions ?? { exact }}
			activeProps={{ "aria-current": "page" }}
			data-density="tab"
			search={search}
			className="flex h-(--control-sm) shrink-0 items-center gap-1.5 rounded-pill px-3 type-label text-text-2 hover:bg-hover hover:text-text-1 aria-[current=page]:bg-pressed aria-[current=page]:text-text-1"
			to={to}
		>
			<Icon icon={icon} />
			<span>{label}</span>
			{typeof value === "number" ? (
				<span className="text-text-2 tabular-nums">
					{value}
					<span className="sr-only"> to review</span>
				</span>
			) : null}
		</Link>
	);
}
