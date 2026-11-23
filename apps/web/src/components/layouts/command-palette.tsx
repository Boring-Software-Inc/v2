import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Forge } from "@tripwire/contracts";
import { FORGE_CATALOG } from "@tripwire/contracts";
import {
	type CommandBadgeData,
	CommandDialog,
	type CommandEntry,
	type CommandLeafItem,
} from "@tripwire/ui/command";
import {
	Activity,
	Add,
	Analytics,
	Connection,
	Customize,
	Home,
	Icon,
	type IconGlyph,
	Moderation,
	Rules,
	Search,
	Settings,
	SignOut,
	Workflow,
} from "@tripwire/ui/icon";
import { notify } from "@tripwire/ui/toast";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { ConnectForgeDialog } from "#/components/forges/connect-forge-dialog";
import { CreateOrgDialog } from "#/components/organizations/create-org-dialog";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useFeaturePath } from "#/hooks/use-feature-path";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useSignOut } from "#/hooks/use-sign-out";
import { armRepo, disarmRepo } from "#/lib/arm.functions";
import type { SwitcherRepo } from "#/lib/onboarding.functions";
import { myOrgsQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";
import { duplicateRepoNames, qualifiedRepoLabel } from "#/lib/repo-label";
import { repoRouteKey } from "#/lib/repo-route";
import { getLatestRunId } from "#/lib/runs.functions";

interface PaletteItemBase {
	id: string;
	label: string;
	/** Alternate names so nothing needs to be typed verbatim. */
	searchTags: string[];
	icon: ReactNode;
	current?: boolean;
	labelBadge?: CommandBadgeData;
	onSelect: () => unknown;
	statusBadges?: readonly CommandBadgeData[];
}

interface NeutralPaletteItem extends PaletteItemBase {
	agentConfirmation?: string;
	confirmation?: never;
	variant?: "default";
}

interface DestructivePaletteItem extends PaletteItemBase {
	confirmation: {
		confirmLabel?: string;
		description?: string;
		title: string;
	};
	variant: "destructive";
}

export type PaletteItem = DestructivePaletteItem | NeutralPaletteItem;

/** Repo rows bucketed by forge THEN owner — the same owner name can exist on
 * two forges, and they are not the same repo. */
interface RepoGroup {
	key: string;
	forge: Forge;
	owner: string;
	items: PaletteItem[];
}

function glyph(icon: IconGlyph): ReactNode {
	return <Icon icon={icon} />;
}

/** The repo's FORGE mark at the palette row's standard size (repo rows +
 * actions) — never a blanket octocat, or a gitlab repo reads as a github one. */
function repoIcon(forge: Forge): ReactNode {
	return <ForgeMark className="size-(--icon) shrink-0" forge={forge} />;
}

export function mapPaletteItemToCommandItem(
	item: PaletteItem,
): CommandLeafItem {
	return item.variant === "destructive"
		? {
				confirmation: item.confirmation,
				current: item.current,
				icon: item.icon,
				keywords: item.searchTags,
				label: item.label,
				labelBadge: item.labelBadge,
				onAction: item.onSelect,
				statusBadges: item.statusBadges,
				tone: "destructive",
				value: item.id,
			}
		: {
				agentConfirmation: item.agentConfirmation,
				current: item.current,
				icon: item.icon,
				keywords: item.searchTags,
				label: item.label,
				labelBadge: item.labelBadge,
				onAction: item.onSelect,
				statusBadges: item.statusBadges,
				value: item.id,
			};
}

export function CommandPalette({
	finalFocus,
	open,
	onClose,
	onQueryChange,
	query,
}: {
	finalFocus: () => HTMLElement | null;
	open: boolean;
	onClose: () => void;
	onQueryChange: (query: string) => void;
	query: string;
}) {
	const queryClient = useQueryClient();
	const signOut = useSignOut();
	const navigate = useNavigate();
	const scope = useActiveScope();
	const currentOrg = scope.org?.slug;
	const currentRepo = scope.repo ?? undefined;

	// Swapping repos keeps the feature page: /org/a/workflows → /org/b/workflows.
	// Only the FIRST segment after the repo carries over — deeper ids (a workflow,
	// a run) belong to the old repo and would 404 in the new one.
	const featurePath = useFeaturePath(currentOrg, currentRepo);

	const { data: orgs, isPending: orgsPending } = useQuery({
		...myOrgsQueryOptions(),
		enabled: open,
	});
	const { data: orgHome, isLoading: orgHomeLoading } = useQuery({
		...orgHomeQueryOptions(currentOrg ?? ""),
		enabled: open && currentOrg !== undefined,
	});
	const canReadActivity = useOrgPermission(currentOrg ?? "", "activity:read");
	const repoScope =
		currentOrg && currentRepo ? { org: currentOrg, repo: currentRepo } : null;
	const { data: latestRunId } = useQuery({
		queryKey: ["runs", "latest", repoScope?.org, repoScope?.repo],
		queryFn: ({ signal }) =>
			repoScope
				? getLatestRunId({ data: repoScope, signal })
				: Promise.resolve(null),
		enabled: open && repoScope !== null && canReadActivity,
		staleTime: 15_000,
	});

	// Both sub-flows layer OVER the palette rather than replacing it — you asked
	// to connect or to create, not to leave. Dismissing either drops you back on
	// the list with your query intact.
	const [connectOpen, setConnectOpen] = useState(false);
	const [createOrgOpen, setCreateOrgOpen] = useState(false);
	const close = () => {
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
				notify.show(
					{
						title:
							"Tripwire is on for this repo. It is loading past change requests.",
					},
					"success",
				);
				return;
			}
			notify.show(
				{
					title:
						!result.ok && result.reason === "queue-unavailable"
							? "Tripwire did not turn on. Try again in a moment."
							: "Tripwire did not turn on for this repo. Reload the page and try again.",
				},
				"error",
			);
		},
		onError: () =>
			notify.show(
				{
					title:
						"Tripwire did not turn on for this repo. Check your connection and try again.",
				},
				"error",
			),
	});
	const disarm = useMutation({
		mutationFn: (input: { org: string; repo: string }) =>
			disarmRepo({ data: input }),
		onSettled: invalidate,
		onSuccess: () =>
			notify.show(
				{
					title:
						"Tripwire is off for this repo. It still records events but no longer checks change requests.",
				},
				"success",
			),
		onError: () =>
			notify.show(
				{ title: "Could not turn off Tripwire for this repo. Try again." },
				"error",
			),
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
				icon: <OrgAvatar hue={org.avatarHue} name={org.name} size="xs" />,
				current: org.slug === currentOrg,
				labelBadge: org.isPersonal
					? { label: "Personal", variant: "outline" }
					: undefined,
				onSelect: () => go(`/${org.slug}/home`),
			});
		}
		items.push({
			id: "org:new",
			label: "Create org",
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
		const duplicateNames = duplicateRepoNames(sorted);
		// Grouped by FORGE then owner, not owner alone. Two forges can hand you the
		// same owner name, and "arm this repo" means different plumbing on each —
		// they share the word "repos" and nothing else, so they don't share a group.
		const groups = new Map<string, RepoGroup>();
		for (const repo of visible) {
			const item = repoItem(
				repo,
				currentRepo ?? null,
				duplicateNames.has(repo.name),
				() => go(`/${currentOrg}/${repoRouteKey(repo)}${featurePath}`),
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
			? (orgHome?.repos.find(
					(repo) =>
						repoRouteKey(repo) === currentRepo || repo.name === currentRepo,
				) ?? null)
			: null;
	if (
		currentOrg &&
		currentRepo &&
		scopedRepo &&
		(scopedRepo.armed || scopedRepo.forge !== "gitcafe")
	) {
		actionItems.push(
			scopedRepo.armed
				? {
						confirmation: {
							confirmLabel: "Turn off Tripwire",
							description:
								"Tripwire will keep recording events but will stop checking change requests for this repository.",
							title: `Turn off Tripwire for ${scopedRepo.fullName}?`,
						},
						id: "action:disarm",
						label: `Turn off Tripwire for ${scopedRepo.fullName}`,
						searchTags: [
							"turn off",
							"disarm",
							"off",
							"stop",
							"gate",
							"repo",
							currentRepo,
						],
						icon: repoIcon(scopedRepo.forge),
						onSelect: () =>
							disarm.mutate({ org: currentOrg, repo: currentRepo }),
						variant: "destructive",
					}
				: {
						agentConfirmation: `Turn on Tripwire for ${scopedRepo.fullName}?`,
						id: "action:arm",
						label: `Turn on Tripwire for ${scopedRepo.fullName}`,
						searchTags: [
							"turn on",
							"arm",
							"on",
							"enable",
							"gate",
							"repo",
							currentRepo,
						],
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
		confirmation: {
			confirmLabel: "Sign out",
			description:
				"Your session on this device ends. You'll need to sign in again to use Tripwire.",
			title: "Sign out of Tripwire?",
		},
		id: "action:sign-out",
		label: "Sign out",
		searchTags: ["sign out", "log out", "logout", "leave"],
		icon: glyph(SignOut),
		onSelect: async () => {
			close();
			await signOut.mutateAsync();
		},
		variant: "destructive",
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
		navItems.push({
			id: "nav:org-analytics",
			label: currentRepo ? "Org analytics" : "Analytics",
			searchTags: ["analytics", "org", "totals", "stats", "charts"],
			icon: glyph(Analytics),
			onSelect: () => go(`/${currentOrg}/analytics`),
		});
		if (currentRepo) {
			navItems.push(
				{
					id: "nav:moderation",
					label: "Human review",
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
					id: "nav:responses",
					label: "Responses",
					searchTags: [
						"responses",
						"customize",
						"redaction",
						"comment",
						"message",
						"check",
						"verdict",
					],
					icon: glyph(Customize),
					onSelect: () => go(`/${currentOrg}/${currentRepo}/responses`),
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
					to: "/$org/settings/connections",
					params: { org: currentOrg },
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
				navigate({
					to: "/$org/settings",
					params: { org: currentOrg },
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
	const commandItems: CommandEntry[] = [];
	if (orgItems.length > 0) {
		commandItems.push({
			items: orgItems.map(mapPaletteItemToCommandItem),
			label: "Orgs",
			type: "group",
		});
	}
	for (const group of repoGroups) {
		commandItems.push({
			items: group.items.map(mapPaletteItemToCommandItem),
			label: `${group.forge} / ${group.owner}`,
			type: "group",
		});
	}
	if (hiddenRepoCount > 0) {
		commandItems.push({
			icon: glyph(Search),
			label: `${hiddenRepoCount} more repos. Type a name to find one.`,
			onAction: () => inputRef.current?.focus(),
			value: "repos:more",
		});
	}
	if (visibleActions.length > 0) {
		commandItems.push({
			items: visibleActions.map(mapPaletteItemToCommandItem),
			label: "Actions",
			type: "group",
		});
	}
	if (visibleNav.length > 0) {
		commandItems.push({
			items: visibleNav.map(mapPaletteItemToCommandItem),
			label: "Pages",
			type: "group",
		});
	}

	return (
		<>
			<CommandDialog
				ariaLabel="Command palette"
				autoFocus
				emptyLabel="No results"
				filter={() => true}
				finalFocus={finalFocus}
				footerHints={[
					{ key: "↑ ↓", label: "Move" },
					{ key: "Enter", label: "Open" },
					{ key: "Esc", label: "Close" },
				]}
				footerResultCount={loading ? undefined : resultCount}
				inputRef={inputRef}
				items={loading ? [] : commandItems}
				loading={loading}
				loadingContent="Loading orgs and repos"
				onOpenChange={(next) => {
					if (!next) close();
				}}
				onQueryChange={onQueryChange}
				open={open}
				placeholder="Search orgs, repos, actions and pages"
				query={query}
				title="Search orgs, repos, actions and pages"
			/>
			<ConnectForgeDialog
				onOpenChange={setConnectOpen}
				open={connectOpen}
				org={currentOrg ?? null}
			/>
			<CreateOrgDialog
				onCreated={(slug) => {
					setCreateOrgOpen(false);
					go(`/${slug}/home`);
				}}
				onOpenChange={setCreateOrgOpen}
				open={createOrgOpen}
			/>
		</>
	);
}

function repoItem(
	repo: SwitcherRepo,
	currentRepoName: string | null,
	disambiguate: boolean,
	onSelect: () => void,
): PaletteItem {
	const isCurrent =
		repoRouteKey(repo) === currentRepoName || repo.name === currentRepoName;
	const statusBadges: CommandBadgeData[] = [];
	if (!repo.armed) {
		statusBadges.push({ label: "Tripwire off", variant: "outline" });
	}
	if (repo.pendingModeration > 0) {
		statusBadges.push({ label: `${repo.pendingModeration} to review` });
	}
	if (repo.blocked24h > 0) {
		statusBadges.push({
			label: `${repo.blocked24h} blocked`,
			tone: "danger",
		});
	}
	return {
		current: isCurrent,
		id: `repo:${repo.id}`,
		label: disambiguate ? qualifiedRepoLabel(repo) : repo.name,
		searchTags: [
			repo.owner,
			repo.name,
			repo.fullName,
			repo.armed ? "on armed" : "off unarmed not armed",
			isCurrent ? "current active" : "",
		],
		icon: repoIcon(repo.forge),
		onSelect,
		statusBadges,
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
