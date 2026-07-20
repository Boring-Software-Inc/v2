import {
	ActivityIcon,
	Analytics01Icon,
	CheckListIcon,
	FlowIcon,
	Home01Icon,
	Logout01Icon,
	PlusSignIcon,
	Queue01Icon,
	Search01Icon,
	Settings01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { Command as CommandPrimitive } from "cmdk";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GithubIcon } from "#/components/icons/github";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { armRepo, disarmRepo } from "#/lib/arm.functions";
import { authClient } from "#/lib/auth-client";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { createOrg } from "#/lib/org.functions";
import {
	myOrgsQueryOptions,
	orgHomeQueryOptions,
	orgQueryKeys,
} from "#/lib/org.query";
import { getLatestRunId } from "#/lib/runs.functions";
import { cn } from "#/lib/utils";

interface PaletteItem {
	id: string;
	label: string;
	/** Alternate names so nothing needs to be typed verbatim. */
	searchTags: string[];
	/** A rendered icon node — a hugeicon, an org avatar, or the GitHub mark. */
	icon: ReactNode;
	hint?: React.ReactNode;
	onSelect: () => void;
}

/** A hugeicon at the palette row's standard size. */
function hugeicon(icon: IconSvgElement): ReactNode {
	return <HugeiconsIcon icon={icon} size={15} strokeWidth={1.9} />;
}

/** The GitHub mark at the palette row's standard size (repo rows + actions). */
function repoIcon(): ReactNode {
	return <GithubIcon className="size-[15px]" />;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	const params = useParams({ strict: false });
	const currentOrg = params.org;
	const currentRepo = params.repo;

	// Swapping repos keeps the feature page: /org/a/workflows → /org/b/workflows.
	// Only the FIRST segment after the repo carries over — deeper ids (a workflow,
	// a run) belong to the old repo and would 404 in the new one.
	const featurePath = (() => {
		if (!currentOrg || !currentRepo) {
			return "";
		}
		const prefix = `/${currentOrg}/${currentRepo}/`;
		if (!location.pathname.startsWith(prefix)) {
			return "";
		}
		const segment = location.pathname.slice(prefix.length).split("/")[0];
		return segment ? `/${segment}` : "";
	})();

	// Mounted only while open ⇒ these fetch on open, not on app mount.
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const { data: orgHome } = useQuery({
		...orgHomeQueryOptions(currentOrg ?? ""),
		enabled: currentOrg !== undefined,
	});
	// Admin-only: the org-bound install URL. GitHub's installations/new page is
	// also the "add more repos" screen once the app is installed — same URL,
	// same signed state, the setup callback + webhook sync pick up the rest.
	const isOrgAdmin =
		(orgs ?? []).find((org) => org.slug === currentOrg)?.role === "admin";
	const { data: installUrl } = useQuery({
		...orgInstallUrlQueryOptions(currentOrg ?? ""),
		enabled: Boolean(currentOrg) && isOrgAdmin,
	});
	const repoScope =
		currentOrg && currentRepo ? { org: currentOrg, repo: currentRepo } : null;
	const { data: latestRunId } = useQuery({
		queryKey: ["runs", "latest", repoScope?.org, repoScope?.repo],
		queryFn: ({ signal }) =>
			repoScope
				? getLatestRunId({ data: repoScope, signal })
				: Promise.resolve(null),
		enabled: repoScope !== null,
		staleTime: 15_000,
	});

	const [view, setView] = useState<"list" | "create-org">("list");
	const [query, setQuery] = useState("");
	const deferred = useDebouncedValue(query, 200);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const invalidate = () => queryClient.invalidateQueries();

	const arm = useMutation({
		mutationFn: (input: { org: string; repo: string }) =>
			armRepo({ data: input }),
		onSettled: invalidate,
		onSuccess: (result) => {
			if (result.armed) {
				toast.success("armed — backfilling its history");
			}
		},
	});
	const disarm = useMutation({
		mutationFn: (input: { org: string; repo: string }) =>
			disarmRepo({ data: input }),
		onSettled: invalidate,
		onSuccess: () => toast.success("disarmed — events still ingest, gate off"),
	});

	function go(path: string) {
		navigate({ to: path });
		onClose();
	}

	const terms = tokenize(deferred);

	// ── ORGS: the switcher, personal first (server order). Cheap to build, so
	// not memoized — closures over `go` stay fresh. ─────────────────────────────
	const orgItems = (() => {
		const items: PaletteItem[] = [];
		for (const org of orgs ?? []) {
			items.push({
				id: `org:${org.id}`,
				label: org.name,
				searchTags: [
					org.slug,
					org.name,
					"org",
					org.isPersonal ? "personal" : "team",
					org.slug === currentOrg ? "current active" : "",
				],
				icon: <OrgAvatar hue={org.avatarHue} name={org.name} size={15} />,
				onSelect: () => go(`/${org.slug}/home`),
				hint: (
					<>
						{org.isPersonal ? (
							<span className="text-muted-foreground text-xs">personal</span>
						) : null}
						{org.slug === currentOrg ? (
							<span className="text-muted-foreground text-xs">current</span>
						) : null}
					</>
				),
			});
		}
		items.push({
			id: "org:new",
			label: "new org",
			searchTags: ["new", "create", "org", "organization", "team"],
			icon: hugeicon(PlusSignIcon),
			onSelect: () => setView("create-org"),
		});
		return items.filter((item) => matches(item, terms));
	})();

	// ── REPOS: only inside an org route; each jump is a URL change. Browse
	// (empty query) is curated: the activity sort already puts the repos you
	// visit on top, so cap it and teach typing for the tail. A query searches
	// the FULL set — matching shrinks the list naturally. ───────────────────────
	const BROWSE_CAP = 8;
	const { repoGroups, hiddenRepoCount } = (() => {
		if (!currentOrg) {
			return {
				repoGroups: [] as [string, PaletteItem[]][],
				hiddenRepoCount: 0,
			};
		}
		const sorted = [...(orgHome?.repos ?? [])].sort(
			(a, b) => activityRank(b) - activityRank(a),
		);
		const browsing = terms.length === 0;
		const visible = browsing ? sorted.slice(0, BROWSE_CAP) : sorted;
		const byOwner = new Map<string, PaletteItem[]>();
		for (const repo of visible) {
			const item = repoItem(repo, currentRepo ?? null, () =>
				go(`/${currentOrg}/${repo.name}${featurePath}`),
			);
			if (!matches(item, terms)) {
				continue;
			}
			const bucket = byOwner.get(repo.owner) ?? [];
			bucket.push(item);
			byOwner.set(repo.owner, bucket);
		}
		return {
			repoGroups: [...byOwner.entries()],
			hiddenRepoCount: browsing ? Math.max(0, sorted.length - BROWSE_CAP) : 0,
		};
	})();

	// ── under the repo list: add repos to the existing installation ─────────────
	const addReposItem: PaletteItem | null =
		currentOrg && installUrl?.status === "ready"
			? {
					id: "repos:add",
					label: "add repos",
					searchTags: [
						"add",
						"repos",
						"repository",
						"install",
						"github",
						"more",
						"grant",
					],
					icon: hugeicon(PlusSignIcon),
					onSelect: () => {
						window.location.assign(installUrl.url);
					},
					hint: <span className="text-muted-foreground text-xs">github</span>,
				}
			: null;
	const visibleAddRepos =
		addReposItem && matches(addReposItem, terms) ? addReposItem : null;

	// ── ACTIONS (cheap to build; not memoized so closures stay fresh) ───────────
	const actionItems: PaletteItem[] = [];
	const scopedRepo =
		currentOrg && currentRepo
			? (orgHome?.repos.find((repo) => repo.name === currentRepo) ?? null)
			: null;
	if (currentOrg && currentRepo && scopedRepo) {
		actionItems.push(
			scopedRepo.armed
				? {
						id: "action:disarm",
						label: `disarm ${scopedRepo.fullName}`,
						searchTags: ["disarm", "off", "stop", "gate", "repo", currentRepo],
						icon: repoIcon(),
						onSelect: () =>
							disarm.mutate({ org: currentOrg, repo: currentRepo }),
					}
				: {
						id: "action:arm",
						label: `arm ${scopedRepo.fullName}`,
						searchTags: ["arm", "on", "enable", "gate", "repo", currentRepo],
						icon: repoIcon(),
						onSelect: () => arm.mutate({ org: currentOrg, repo: currentRepo }),
					},
		);
	}
	if (latestRunId) {
		actionItems.push({
			id: "action:latest-run",
			label: "open latest run",
			searchTags: ["run", "latest", "verdict", "result", "jump"],
			icon: hugeicon(ActivityIcon),
			onSelect: () => go(`/runs/${latestRunId}`),
		});
	}
	actionItems.push({
		id: "action:sign-out",
		label: "sign out",
		searchTags: ["sign out", "log out", "logout", "leave"],
		icon: hugeicon(Logout01Icon),
		onSelect: () =>
			authClient.signOut({
				fetchOptions: { onSuccess: () => window.location.assign("/login") },
			}),
	});

	// ── NAVIGATION: org-scoped always; repo-scoped only with a repo in context ──
	const navItems: PaletteItem[] = [];
	if (currentOrg) {
		navItems.push({
			id: "nav:home",
			label: "home",
			searchTags: ["home", "overview", "dashboard", "repos"],
			icon: hugeicon(Home01Icon),
			onSelect: () => go(`/${currentOrg}/home`),
		});
		if (currentRepo) {
			navItems.push(
				{
					id: "nav:moderation",
					label: "moderation",
					searchTags: ["moderation", "queue", "review", "pending", "triage"],
					icon: hugeicon(Queue01Icon),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/moderation`),
				},
				{
					id: "nav:activity",
					label: "activity",
					searchTags: ["activity", "events", "runs", "feed", "stream"],
					icon: hugeicon(ActivityIcon),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/activity`),
				},
				{
					id: "nav:rules",
					label: "rules",
					searchTags: ["rules", "gate", "block", "checks", "gatekeeper"],
					icon: hugeicon(CheckListIcon),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/rules`),
				},
				{
					id: "nav:workflows",
					label: "workflows",
					searchTags: ["workflows", "automation", "pipeline", "dag"],
					icon: hugeicon(FlowIcon),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/workflows`),
				},
				{
					id: "nav:analytics",
					label: "analytics",
					searchTags: ["analytics", "stats", "charts", "trends"],
					icon: hugeicon(Analytics01Icon),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/analytics`),
				},
			);
		}
		navItems.push({
			id: "nav:settings",
			label: "settings",
			searchTags: ["settings", "members", "invites", "org", "admin"],
			icon: hugeicon(Settings01Icon),
			onSelect: () => {
				// Opens the settings dialog over whatever page is showing.
				navigate({
					to: ".",
					search: (prev) => ({ ...prev, settings: "members" as const }),
				});
				onClose();
			},
		});
	}

	const visibleActions = actionItems.filter((item) => matches(item, terms));
	const visibleNav = navItems.filter((item) => matches(item, terms));
	const resultCount =
		orgItems.length +
		repoGroups.reduce((sum, [, list]) => sum + list.length, 0) +
		(visibleAddRepos ? 1 : 0) +
		visibleActions.length +
		visibleNav.length;

	return (
		<div className="fixed inset-0 z-50">
			<button
				aria-label="close command palette"
				className="absolute inset-0 bg-background/60"
				onClick={onClose}
				type="button"
			/>
			<div
				aria-modal="true"
				className="-translate-x-1/2 absolute top-[12vh] left-1/2 w-full max-w-lg px-4"
				role="dialog"
			>
				{view === "create-org" ? (
					<div className="overflow-hidden rounded-xl border bg-popover shadow-lg">
						<CreateOrgForm
							onBack={() => setView("list")}
							onCreated={(slug) => go(`/${slug}/home`)}
						/>
					</div>
				) : (
					<CommandPrimitive
						className="overflow-hidden rounded-xl border bg-popover shadow-lg [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide"
						label="Command palette"
						loop
						shouldFilter={false}
					>
						<div className="flex items-center gap-2 border-b px-3">
							<HugeiconsIcon
								className="shrink-0 text-muted-foreground"
								icon={Search01Icon}
								size={16}
								strokeWidth={2}
							/>
							<CommandPrimitive.Input
								className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
								onValueChange={setQuery}
								placeholder="search orgs, repos, actions, pages…"
								ref={inputRef}
								value={query}
							/>
						</div>

						<CommandPrimitive.List className="max-h-[50vh] overflow-y-auto py-1">
							<CommandPrimitive.Empty className="px-4 py-6 text-center text-muted-foreground text-sm">
								nothing matches.
							</CommandPrimitive.Empty>

							{orgItems.length > 0 ? (
								<CommandPrimitive.Group heading="Orgs">
									{orgItems.map((item) => (
										<PaletteRow item={item} key={item.id} />
									))}
								</CommandPrimitive.Group>
							) : null}

							{repoGroups.map(([owner, items]) => (
								<CommandPrimitive.Group heading={owner} key={owner}>
									{items.map((item) => (
										<PaletteRow item={item} key={item.id} />
									))}
								</CommandPrimitive.Group>
							))}

							{hiddenRepoCount > 0 ? (
								<CommandPrimitive.Group>
									<CommandPrimitive.Item
										className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-muted-foreground text-xs data-[selected=true]:bg-surface-1"
										onSelect={() => inputRef.current?.focus()}
										value="repos:more"
									>
										<span className="flex size-[15px] shrink-0 items-center justify-center">
											<HugeiconsIcon
												icon={Search01Icon}
												size={13}
												strokeWidth={1.9}
											/>
										</span>
										{hiddenRepoCount} more — type to search
									</CommandPrimitive.Item>
								</CommandPrimitive.Group>
							) : null}

							{visibleAddRepos ? (
								<CommandPrimitive.Group>
									<PaletteRow item={visibleAddRepos} />
								</CommandPrimitive.Group>
							) : null}

							{visibleActions.length > 0 ? (
								<CommandPrimitive.Group heading="Actions">
									{visibleActions.map((item) => (
										<PaletteRow item={item} key={item.id} />
									))}
								</CommandPrimitive.Group>
							) : null}

							{visibleNav.length > 0 ? (
								<CommandPrimitive.Group heading="Navigation">
									{visibleNav.map((item) => (
										<PaletteRow item={item} key={item.id} />
									))}
								</CommandPrimitive.Group>
							) : null}
						</CommandPrimitive.List>

						<div className="flex items-center justify-between border-t px-3 py-2 text-muted-foreground text-[11px]">
							<span className="flex items-center gap-3">
								<span>
									<kbd className="font-mono">↑↓</kbd> navigate
								</span>
								<span>
									<kbd className="font-mono">↵</kbd> select
								</span>
								<span>
									<kbd className="font-mono">esc</kbd> close
								</span>
							</span>
							<span className="tabular-nums">{resultCount} results</span>
						</div>
					</CommandPrimitive>
				)}
			</div>
		</div>
	);
}

/**
 * Inline org creation — the name drives a LIVE avatar preview (§7) and an
 * auto-derived slug the user can take over; orgSlugSchema holds the line on
 * both sides of the wire.
 */
function CreateOrgForm({
	onCreated,
	onBack,
}: {
	onCreated: (slug: string) => void;
	onBack: () => void;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [slugOverride, setSlugOverride] = useState<string | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	const slug = slugOverride ?? (name ? slugifyOrgName(name) : "");
	const slugCheck = slug ? orgSlugSchema.safeParse(slug) : null;
	const slugError =
		slugCheck && !slugCheck.success
			? (slugCheck.error.issues[0]?.message ?? "invalid slug")
			: null;

	const create = useMutation({
		mutationFn: () => createOrg({ data: { name: name.trim(), slug } }),
		onSuccess: (result) => {
			if ("error" in result) {
				setServerError(result.error);
				return;
			}
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.all });
			onCreated(result.slug);
		},
	});

	const canSubmit =
		name.trim().length > 0 &&
		slug.length > 0 &&
		!slugError &&
		!create.isPending;

	return (
		<form
			className="flex flex-col gap-3 p-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSubmit) {
					setServerError(null);
					create.mutate();
				}
			}}
		>
			<div className="flex items-center justify-between">
				<span className="font-medium text-[13px]">new org</span>
				<button
					className="text-[12px] text-muted-foreground hover:text-foreground"
					onClick={onBack}
					type="button"
				>
					back
				</button>
			</div>

			<div className="flex items-center gap-3">
				<OrgAvatar animate name={name} size={36} />
				<input
					className="h-9 w-full rounded-md border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
					onChange={(event) => setName(event.target.value)}
					placeholder="org name"
					ref={nameRef}
					value={name}
				/>
			</div>

			<div className="flex flex-col gap-1">
				<label
					className="text-[11px] text-muted-foreground uppercase tracking-wide"
					htmlFor="new-org-slug"
				>
					slug
				</label>
				<input
					className="h-9 w-full rounded-md border bg-transparent px-2.5 font-mono text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
					id="new-org-slug"
					onChange={(event) =>
						setSlugOverride(event.target.value.toLowerCase())
					}
					placeholder="org-slug"
					value={slug}
				/>
				{slugError ? (
					<span className="text-[12px] text-destructive">{slugError}</span>
				) : (
					<span className="text-[12px] text-muted-foreground">
						{slug ? `/${slug}/home` : "lives in the url"}
					</span>
				)}
			</div>

			{serverError ? (
				<span className="text-[12px] text-destructive">{serverError}</span>
			) : null}

			<button
				className="h-9 rounded-md bg-foreground font-medium text-[13px] text-background transition-opacity hover:opacity-90 disabled:opacity-50"
				disabled={!canSubmit}
				type="submit"
			>
				{create.isPending ? "creating…" : "create org"}
			</button>
		</form>
	);
}

function PaletteRow({ item }: { item: PaletteItem }) {
	return (
		<CommandPrimitive.Item
			className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface-1"
			onSelect={item.onSelect}
			value={item.id}
		>
			<span className="flex size-[15px] shrink-0 items-center justify-center text-muted-foreground">
				{item.icon}
			</span>
			<span className="min-w-0 flex-1 truncate">{item.label}</span>
			{item.hint ? (
				<span className="flex shrink-0 items-center gap-1.5">{item.hint}</span>
			) : null}
		</CommandPrimitive.Item>
	);
}

function repoItem(
	repo: SwitcherRepo,
	currentRepoName: string | null,
	onSelect: () => void,
): PaletteItem {
	const isCurrent = repo.name === currentRepoName;
	return {
		id: `repo:${repo.id}`,
		label: repo.name,
		searchTags: [
			repo.owner,
			repo.name,
			repo.fullName,
			repo.armed ? "armed" : "unarmed not armed",
			isCurrent ? "current active" : "",
		],
		icon: repoIcon(),
		onSelect,
		hint: (
			<>
				<span
					className={cn(
						"size-1.5 rounded-full",
						repo.armed ? "bg-emerald-500" : "bg-muted-foreground/30",
					)}
					title={repo.armed ? "armed" : "not armed"}
				/>
				{repo.pendingModeration > 0 ? (
					<RowChip>{repo.pendingModeration} pending</RowChip>
				) : null}
				{repo.blocked24h > 0 ? (
					<RowChip tone="red">{repo.blocked24h} blocked</RowChip>
				) : null}
				{isCurrent ? (
					<span className="text-muted-foreground text-xs">current</span>
				) : null}
			</>
		),
	};
}

function RowChip({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone?: "red";
}) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-full px-1.5 py-0.5 text-[11px]",
				tone === "red"
					? "bg-red-500/10 text-red-600 dark:text-red-400"
					: "bg-surface-2 text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}

/** Multi-word AND: every term must appear in the item's searchable string. */
function matches(item: PaletteItem, terms: string[]): boolean {
	if (terms.length === 0) {
		return true;
	}
	const hay = `${item.label} ${item.searchTags.join(" ")}`.toLowerCase();
	return terms.every((term) => hay.includes(term));
}

function tokenize(query: string): string[] {
	return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Most-recent activity first; repos that never fired sink to the bottom. */
function activityRank(repo: SwitcherRepo): number {
	return repo.lastActivityAt ? Date.parse(repo.lastActivityAt) : 0;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
