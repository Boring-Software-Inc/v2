import type {
	DevAccount,
	DevRepos,
	DevScenario,
	DevWorkflows,
} from "#/lib/dev/scenarios";

export const DEV_PASSWORD = "tripwire-dev-persona";
export const TEAM_ORG_SLUG = "demo-team";
export const APPROVED_INSTALLATION_ID = "demo-inst-pending";

export interface DevUserPlan {
	email: string;
	name: string;
}

export interface RepoPlan {
	kind: Exclude<DevRepos, "none">;
	installationId: string;
	names: string[];
	storyDays: number | null;
}

export interface UnclaimedPlan {
	installationId: string;
	account: string;
	repoNames: string[];
}

export interface ScenarioPlan {
	user: DevUserPlan | null;
	orgKind: "personal" | "team";
	teamRole: "member" | null;
	repos: RepoPlan | null;
	unclaimed: UnclaimedPlan | null;
	approvedRequest: boolean;
	workflows: DevWorkflows;
	publicRun: boolean;
}

const USERS = {
	owner: { email: "owner@tripwire.demo", name: "Dev owner" },
	member: { email: "member@tripwire.demo", name: "Dev member" },
	outsider: { email: "outsider@tripwire.demo", name: "Dev outsider" },
} satisfies Record<Exclude<DevAccount, "anonymous">, DevUserPlan>;

const REPOS = {
	empty: {
		installationId: "demo-inst-empty",
		names: ["empty-repo"],
		storyDays: null,
	},
	one: {
		installationId: "demo-inst-one",
		names: ["solo-webapp"],
		storyDays: 365,
	},
	many: {
		installationId: "demo-inst-many",
		names: ["many-api", "many-web", "many-docs", "many-infra"],
		storyDays: 120,
	},
	active: {
		installationId: "demo-inst-active",
		names: ["active-webapp"],
		storyDays: 365,
	},
} satisfies Record<Exclude<DevRepos, "none">, Omit<RepoPlan, "kind">>;

const UNCLAIMED_ACCOUNT = "tripwire-demo";

export function planScenario(scenario: DevScenario): ScenarioPlan {
	const user =
		scenario.account === "anonymous" ? null : USERS[scenario.account];
	const repos =
		scenario.repos === "none"
			? null
			: { kind: scenario.repos, ...REPOS[scenario.repos] };
	return {
		user,
		orgKind: scenario.account === "owner" ? "personal" : "team",
		teamRole: scenario.account === "member" ? "member" : null,
		repos,
		unclaimed: unclaimedFor(scenario),
		approvedRequest: scenario.install === "request-approved",
		workflows: scenario.workflows,
		publicRun:
			scenario.account === "anonymous" || scenario.landing === "public-run",
	};
}

function unclaimedFor(scenario: DevScenario): UnclaimedPlan | null {
	if (scenario.install === "awaiting-confirmation") {
		return {
			installationId: "demo-inst-confirm",
			account: UNCLAIMED_ACCOUNT,
			repoNames: ["confirm-api", "confirm-web"],
		};
	}
	if (scenario.install === "syncing") {
		return {
			installationId: "demo-inst-syncing",
			account: UNCLAIMED_ACCOUNT,
			repoNames: [],
		};
	}
	return null;
}

export interface SeededScenario {
	orgSlug: string | null;
	repoName: string | null;
	workflowId: string | null;
	installState: string | null;
	publicRunId: string | null;
}

export function resolveLanding(
	scenario: DevScenario,
	plan: ScenarioPlan,
	seeded: SeededScenario,
): string {
	const org = seeded.orgSlug;
	const home = org ? `/${org}/home` : "/";
	const repo = org && seeded.repoName ? `/${org}/${seeded.repoName}` : null;
	switch (scenario.landing) {
		case "public-run":
			return seeded.publicRunId ? `/runs/${seeded.publicRunId}` : "/";
		case "home":
			return home;
		case "settings":
			return org ? `${home}?settings=settings` : "/";
		case "repo":
			return repo ?? home;
		case "workflows":
			return repo ? `${repo}/workflows` : home;
		case "workflow":
			return workflowLanding(repo, seeded.workflowId) ?? home;
		case "install-setup":
			return installSetupLanding(scenario, plan, seeded) ?? home;
		default:
			return home;
	}
}

function workflowLanding(
	repo: string | null,
	workflowId: string | null,
): string | null {
	if (!repo) {
		return null;
	}
	return workflowId ? `${repo}/workflows/${workflowId}` : `${repo}/workflows`;
}

function installSetupLanding(
	scenario: DevScenario,
	plan: ScenarioPlan,
	seeded: SeededScenario,
): string | null {
	if (scenario.install === "request-pending") {
		return "/onboarding/setup?setup_action=request";
	}
	if (scenario.install === "request-approved") {
		return `/onboarding/setup?installation_id=${APPROVED_INSTALLATION_ID}`;
	}
	if (!(plan.unclaimed && seeded.installState)) {
		return null;
	}
	const search = new URLSearchParams({
		installation_id: plan.unclaimed.installationId,
		setup_action: "install",
		state: seeded.installState,
	});
	return `/onboarding/setup?${search.toString()}`;
}
