import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import type { Forge } from "@tripwire/contracts";
import {
	FORGE_CATALOG,
	orgSlugSchema,
	slugifyOrgName,
} from "@tripwire/contracts";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import {
	Activity,
	Add,
	Analytics,
	Connection,
	type GlazeIcon,
	Home,
	Icon,
	Moderation,
	Rules,
	Search,
	Settings,
	SignOut,
	Workflow,
} from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandHint,
	CommandInput,
	CommandItem,
	CommandLabel,
	CommandList,
	CommandLoading,
} from "#/components/glaze/ui/command";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { toast } from "#/components/glaze/ui/toast";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { armRepo, disarmRepo } from "#/lib/arm.functions";
import { authClient } from "#/lib/auth-client";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { createOrg } from "#/lib/org.functions";
import {
	myOrgsQueryOptions,
	orgHomeQueryOptions,
	orgQueryKeys,
} from "#/lib/org.query";
import { getLatestRunId } from "#/lib/runs.functions";

interface PaletteItem {
	id: string;
	label: string;
	/** Alternate names so nothing needs to be typed verbatim. */
	searchTags: string[];
	icon: ReactNode;
	hint?: React.ReactNode;
	onSelect: () => void;
}

/** Repo rows bucketed by forge THEN owner — the same owner name can exist on
 * two forges, and they are not the same repo. */
interface RepoGroup {
	key: string;
	forge: Forge;
	owner: string;
	items: PaletteItem[];
}

function glyph(icon: GlazeIcon): ReactNode {
	return <Icon icon={icon} />;
}

/** The repo's FORGE mark at the palette row's standard size (repo rows +
 * actions) — never a blanket octocat, or a gitlab repo reads as a github one. */
function repoIcon(forge: Forge): ReactNode {
	return <ForgeMark className="size-(--icon) shrink-0" forge={forge} />;
}

export function CommandPalette({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
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

	const { data: orgs, isPending: orgsPending } = useQuery({
		...myOrgsQueryOptions(),
		enabled: open,
	});
	const { data: orgHome, isLoading: orgHomeLoading } = useQuery({
		...orgHomeQueryOptions(currentOrg ?? ""),
		enabled: open && currentOrg !== undefined,
	});
	const repoScope =
		currentOrg && currentRepo ? { org: currentOrg, repo: currentRepo } : null;
	const { data: latestRunId } = useQuery({
		queryKey: ["runs", "latest", repoScope?.org, repoScope?.repo],
		queryFn: ({ signal }) =>
			repoScope
				? getLatestRunId({ data: repoScope, signal })
				: Promise.resolve(null),
		enabled: open && repoScope !== null,
		staleTime: 15_000,
	});

	// Both sub-flows layer OVER the palette rather than replacing it — you asked
	// to connect or to create, not to leave. Dismissing either drops you back on
	// the list with your query intact.
	const [connectOpen, setConnectOpen] = useState(false);
	const [createOrgOpen, setCreateOrgOpen] = useState(false);
	const [query, setQuery] = useState("");
	const close = () => {
		setQuery("");
		setConnectOpen(false);
		setCreateOrgOpen(false);
		onClose();
	};
	const deferred = useDebouncedValue(query, 200);
	const inputRef = useRef<HTMLInputElement>(null);

	const invalidate = () => queryClient.invalidateQueries();

	const arm = useMutation({
		mutationFn: (input: { org: string; repo: string }) =>
			armRepo({ data: input }),
		onSettled: invalidate,
		onSuccess: (result) => {
			if (result.armed) {
				toast.success("Armed. Backfilling its history.");
			}
		},
	});
	const disarm = useMutation({
		mutationFn: (input: { org: string; repo: string }) =>
			disarmRepo({ data: input }),
		onSettled: invalidate,
		onSuccess: () => toast.success("Disarmed. Events still ingest, gate off."),
	});
	function go(path: string) {
		navigate({ to: path });
		close();
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
				icon: <OrgAvatar eyes hue={org.avatarHue} name={org.name} size="xs" />,
				onSelect: () => go(`/${org.slug}/home`),
				hint: (
					<>
						{org.isPersonal ? (
							<span className="type-caption text-text-2">Personal</span>
						) : null}
						{org.slug === currentOrg ? (
							<span className="type-caption text-text-2">Current</span>
						) : null}
					</>
				),
			});
		}
		items.push({
			id: "org:new",
			label: "New org",
			searchTags: ["new", "create", "org", "organization", "team"],
			icon: glyph(Add),
			onSelect: () => setCreateOrgOpen(true),
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
			return { repoGroups: [] as RepoGroup[], hiddenRepoCount: 0 };
		}
		const sorted = [...(orgHome?.repos ?? [])].sort(
			(a, b) => activityRank(b) - activityRank(a),
		);
		const browsing = terms.length === 0;
		// The cap is spent ROUND-ROBIN across forges, not top-N by activity. A
		// straight slice is forge-blind: a freshly connected forge has no runs yet,
		// so every one of its repos sorts below the github ones and falls off the
		// end — 7 github visible, its 2 gitlab repos hidden behind "1 more". The
		// newest connection is exactly the one you are looking for, so it must not
		// be the first thing the cap eats.
		const visible = browsing ? capPerForge(sorted, BROWSE_CAP) : sorted;
		// Grouped by FORGE then owner, not owner alone. Two forges can hand you the
		// same owner name, and "arm this repo" means different plumbing on each —
		// they share the word "repos" and nothing else, so they don't share a group.
		const groups = new Map<string, RepoGroup>();
		for (const repo of visible) {
			const item = repoItem(repo, currentRepo ?? null, () =>
				go(`/${currentOrg}/${repo.name}${featurePath}`),
			);
			if (!matches(item, terms)) {
				continue;
			}
			const key = `${repo.forge}/${repo.owner}`;
			const bucket = groups.get(key) ?? {
				key,
				forge: repo.forge,
				owner: repo.owner,
				items: [],
			};
			bucket.items.push(item);
			groups.set(key, bucket);
		}
		// Catalog order clusters every github group above every gitlab one, so the
		// forge boundary is a block in the list rather than a per-row detail.
		const rank = (forge: Forge) =>
			FORGE_CATALOG.findIndex((entry) => entry.id === forge);
		return {
			repoGroups: [...groups.values()].sort(
				(a, b) =>
					rank(a.forge) - rank(b.forge) || a.owner.localeCompare(b.owner),
			),
			hiddenRepoCount: browsing ? Math.max(0, sorted.length - BROWSE_CAP) : 0,
		};
	})();

	// ── ACTIONS (cheap to build; not memoized so closures stay fresh) ───────────
	const actionItems: PaletteItem[] = [];
	// ONE connect entry. Which forge is a choice made inside it, not a fork in
	// the menu — "add repos" (meaning github) next to "connect gitlab repos" read
	// as two features when they are one intent.
	actionItems.push({
		id: "repos:connect",
		label: "Connect repos",
		searchTags: [
			"connect",
			"add",
			"import",
			"repos",
			"repository",
			"install",
			"forge",
			"grant",
			...FORGE_CATALOG.map((forge) => forge.id),
		],
		icon: glyph(Add),
		onSelect: () => setConnectOpen(true),
	});
	const scopedRepo =
		currentOrg && currentRepo
			? (orgHome?.repos.find((repo) => repo.name === currentRepo) ?? null)
			: null;
	if (currentOrg && currentRepo && scopedRepo) {
		actionItems.push(
			scopedRepo.armed
				? {
						id: "action:disarm",
						label: `Disarm ${scopedRepo.fullName}`,
						searchTags: ["disarm", "off", "stop", "gate", "repo", currentRepo],
						icon: repoIcon(scopedRepo.forge),
						onSelect: () =>
							disarm.mutate({ org: currentOrg, repo: currentRepo }),
					}
				: {
						id: "action:arm",
						label: `Arm ${scopedRepo.fullName}`,
						searchTags: ["arm", "on", "enable", "gate", "repo", currentRepo],
						icon: repoIcon(scopedRepo.forge),
						onSelect: () => arm.mutate({ org: currentOrg, repo: currentRepo }),
					},
		);
	}
	if (latestRunId) {
		actionItems.push({
			id: "action:latest-run",
			label: "Open latest run",
			searchTags: ["run", "latest", "verdict", "result", "jump"],
			icon: glyph(Activity),
			onSelect: () => go(`/runs/${latestRunId}`),
		});
	}
	actionItems.push({
		id: "action:sign-out",
		label: "Sign out",
		searchTags: ["sign out", "log out", "logout", "leave"],
		icon: glyph(SignOut),
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
			label: "Home",
			searchTags: ["home", "overview", "dashboard", "repos"],
			icon: glyph(Home),
			onSelect: () => go(`/${currentOrg}/home`),
		});
		if (currentRepo) {
			navItems.push(
				{
					id: "nav:moderation",
					label: "Moderation",
					searchTags: ["moderation", "queue", "review", "pending", "triage"],
					icon: glyph(Moderation),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/moderation`),
				},
				{
					id: "nav:activity",
					label: "Activity",
					searchTags: ["activity", "events", "runs", "feed", "stream"],
					icon: glyph(Activity),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/activity`),
				},
				{
					id: "nav:rules",
					label: "Rules",
					searchTags: ["rules", "gate", "block", "checks", "gatekeeper"],
					icon: glyph(Rules),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/rules`),
				},
				{
					id: "nav:workflows",
					label: "Workflows",
					searchTags: ["workflows", "automation", "pipeline", "dag"],
					icon: glyph(Workflow),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/workflows`),
				},
				{
					id: "nav:analytics",
					label: "Analytics",
					searchTags: ["analytics", "stats", "charts", "trends"],
					icon: glyph(Analytics),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/analytics`),
				},
			);
		}
		navItems.push({
			id: "nav:connections",
			label: "Connections",
			searchTags: [
				"connections",
				"forge",
				"linked",
				"accounts",
				"disconnect",
				"remove",
				...FORGE_CATALOG.map((forge) => forge.id),
			],
			icon: glyph(Connection),
			onSelect: () => {
				navigate({
					to: ".",
					search: (prev) => ({ ...prev, settings: "connections" as const }),
				});
				close();
			},
		});
		navItems.push({
			id: "nav:settings",
			label: "Settings",
			searchTags: ["settings", "members", "invites", "org", "admin"],
			icon: glyph(Settings),
			onSelect: () => {
				// Opens the settings dialog over whatever page is showing.
				navigate({
					to: ".",
					search: (prev) => ({ ...prev, settings: "members" as const }),
				});
				close();
			},
		});
	}

	const visibleActions = actionItems.filter((item) => matches(item, terms));
	const visibleNav = navItems.filter((item) => matches(item, terms));
	const loading = orgsPending || orgHomeLoading;
	const resultCount =
		orgItems.length +
		repoGroups.reduce((sum, group) => sum + group.items.length, 0) +
		visibleActions.length +
		visibleNav.length;

	return (
		<CommandDialog
			onOpenChange={(next) => {
				if (!next) {
					close();
				}
			}}
			open={open}
			title="Search orgs, repos, actions and pages"
		>
			<Command label="Command palette" loop shouldFilter={false}>
				<CommandInput
					data-autofocus
					onValueChange={setQuery}
					placeholder="Search orgs, repos, actions and pages"
					ref={inputRef}
					value={query}
				/>

				<CommandList>
					<CommandEmpty />
					{loading ? (
						<CommandLoading>Loading orgs and repos</CommandLoading>
					) : null}

					{!loading && orgItems.length > 0 ? (
						<CommandGroup heading="Orgs">
							{orgItems.map((item) => (
								<PaletteRow item={item} key={item.id} />
							))}
						</CommandGroup>
					) : null}

					{(loading ? [] : repoGroups).map((group) => (
						<CommandGroup
							heading={
								<span className="flex items-center gap-1">
									<ForgeMark
										className="size-(--icon-sm) shrink-0"
										forge={group.forge}
									/>
									{group.owner}
								</span>
							}
							key={group.key}
						>
							{group.items.map((item) => (
								<PaletteRow item={item} key={item.id} />
							))}
						</CommandGroup>
					))}

					{!loading && hiddenRepoCount > 0 ? (
						<CommandGroup>
							<CommandItem
								onSelect={() => inputRef.current?.focus()}
								value="repos:more"
							>
								<Icon icon={Search} />
								<CommandLabel className="text-text-2">
									{`${hiddenRepoCount} more. Type to search.`}
								</CommandLabel>
							</CommandItem>
						</CommandGroup>
					) : null}

					{!loading && visibleActions.length > 0 ? (
						<CommandGroup heading="Actions">
							{visibleActions.map((item) => (
								<PaletteRow item={item} key={item.id} />
							))}
						</CommandGroup>
					) : null}

					{!loading && visibleNav.length > 0 ? (
						<CommandGroup heading="Navigation">
							{visibleNav.map((item) => (
								<PaletteRow item={item} key={item.id} />
							))}
						</CommandGroup>
					) : null}
				</CommandList>
			</Command>
			<CommandFooter>
				<CommandHint keys={["↑", "↓"]}>Navigate</CommandHint>
				<CommandHint keys={["↵"]}>Select</CommandHint>
				<CommandHint keys={["esc"]}>Close</CommandHint>
				<span className="ms-auto tabular-nums">
					{resultCount === 1 ? "1 result" : `${resultCount} results`}
				</span>
			</CommandFooter>
			<ConnectForgeDialog
				onOpenChange={setConnectOpen}
				open={connectOpen}
				org={currentOrg ?? null}
			/>
			<Dialog onOpenChange={setCreateOrgOpen} open={createOrgOpen}>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>New org</DialogTitle>
						<DialogDescription>You can rename it later.</DialogDescription>
					</DialogHeader>
					<CreateOrgForm
						onCreated={(slug) => {
							setCreateOrgOpen(false);
							go(`/${slug}/home`);
						}}
					/>
				</DialogContent>
			</Dialog>
		</CommandDialog>
	);
}

function CreateOrgForm({ onCreated }: { onCreated: (slug: string) => void }) {
	const queryClient = useQueryClient();
	const formId = useId();
	const [name, setName] = useState("");
	const [slugOverride, setSlugOverride] = useState<string | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);

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
		<>
			<DialogBody>
				<form
					className="flex flex-col gap-4"
					id={formId}
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit) {
							setServerError(null);
							create.mutate();
						}
					}}
				>
					<div className="flex items-end gap-3">
						<OrgAvatar animate className="mb-1" name={name} size="lg" />
						<Field className="flex-1">
							<FieldLabel>Org name</FieldLabel>
							<Input
								autoComplete="off"
								data-autofocus
								onValueChange={setName}
								placeholder="Acme"
								value={name}
							/>
						</Field>
					</div>

					<Field invalid={slugError !== null}>
						<FieldLabel>Slug</FieldLabel>
						<Input
							autoComplete="off"
							mono
							onValueChange={(value) => setSlugOverride(value.toLowerCase())}
							placeholder="acme"
							value={slug}
						/>
						{slugError ? (
							<FieldError>{slugError}</FieldError>
						) : (
							<FieldDescription>
								{slug ? `/${slug}/home` : "Lives in the URL."}
							</FieldDescription>
						)}
					</Field>

					{serverError ? (
						<p className="type-body-sm text-fail-text" role="alert">
							{serverError}
						</p>
					) : null}
				</form>
			</DialogBody>
			<DialogFooter>
				<DialogClose>Cancel</DialogClose>
				<DialogAction
					close={false}
					disabled={!canSubmit}
					form={formId}
					pending={create.isPending}
					type="submit"
				>
					Create org
				</DialogAction>
			</DialogFooter>
		</>
	);
}

function PaletteRow({ item }: { item: PaletteItem }) {
	return (
		<CommandItem onSelect={item.onSelect} value={item.id}>
			{item.icon}
			<CommandLabel className="flex-1">{item.label}</CommandLabel>
			{item.hint ? (
				<span className="ms-auto flex shrink-0 items-center gap-2">
					{item.hint}
				</span>
			) : null}
		</CommandItem>
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
		icon: repoIcon(repo.forge),
		onSelect,
		hint: (
			<>
				{repo.armed ? null : (
					<Badge size="sm" variant="outline">
						Not armed
					</Badge>
				)}
				{repo.pendingModeration > 0 ? (
					<Badge size="sm">{repo.pendingModeration} pending</Badge>
				) : null}
				{repo.blocked24h > 0 ? (
					<Badge size="sm" variant="fail">
						{repo.blocked24h} blocked
					</Badge>
				) : null}
				{isCurrent ? (
					<span className="type-caption text-text-2">Current</span>
				) : null}
			</>
		),
	};
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

/**
 * Spend a browse cap fairly across forges: take one repo from each forge in
 * turn, in catalog order, until the cap runs out. Within a forge the incoming
 * activity order is preserved, so the "most recently active first" intent still
 * holds — it just applies per forge instead of globally.
 */
function capPerForge(repos: SwitcherRepo[], cap: number): SwitcherRepo[] {
	const byForge = new Map<Forge, SwitcherRepo[]>();
	for (const repo of repos) {
		const bucket = byForge.get(repo.forge) ?? [];
		bucket.push(repo);
		byForge.set(repo.forge, bucket);
	}
	// Catalog order, live entries only — a planned forge has no adapter, so it
	// can never own a repo.
	const queues = FORGE_CATALOG.filter((entry) => entry.status === "live")
		.map((entry) => byForge.get(entry.id))
		.filter((queue): queue is SwitcherRepo[] => queue !== undefined);
	const picked: SwitcherRepo[] = [];
	let round = 0;
	while (picked.length < cap) {
		const before = picked.length;
		for (const queue of queues) {
			const next = queue[round];
			if (next && picked.length < cap) {
				picked.push(next);
			}
		}
		if (picked.length === before) {
			break;
		}
		round += 1;
	}
	return picked;
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
