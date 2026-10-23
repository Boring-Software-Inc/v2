import type { DemoRecoveryState } from "@tripwire/db";
import {
	type DevAccount,
	type DevRecoveryInstall,
	type DevRepos,
	type DevScenario,
	type DevWorkflows,
	isRecoveryInstall,
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

export interface RecoveryPlan {
	installationId: string;
	state: DemoRecoveryState;
}

export interface ScenarioPlan {
	user: DevUserPlan | null;
	orgKind: "personal" | "team";
	teamRole: "member" | "moderator" | "admin" | null;
	repos: RepoPlan | null;
	unclaimed: UnclaimedPlan | null;
	recovery: RecoveryPlan | null;
	approvedRequest: boolean;
	workflows: DevWorkflows;
	publicRun: boolean;
}

const USERS = {
	owner: { email: "owner@tripwire.demo", name: "Dev owner" },
	member: { email: "member@tripwire.demo", name: "Dev member" },
	moderator: { email: "moderator@tripwire.demo", name: "Dev moderator" },
	"team-admin": { email: "team-admin@tripwire.demo", name: "Dev team admin" },
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

const RECOVERY_PLANS = {
	"install-processing": {
		installationId: "demo-inst-processing",
		state: "processing",
	},
	"install-recovering": {
		installationId: "demo-inst-recovering",
		state: "recovering",
	},
	"install-unreadable": {
		installationId: "demo-inst-unreadable",
		state: "unreadable",
	},
	"install-missing": { installationId: "demo-inst-missing", state: "missing" },
	"install-not-for-tripwire": {
		installationId: "demo-inst-foreign",
		state: "not-for-tripwire",
	},
	"install-not-yours": {
		installationId: "demo-inst-not-yours",
		state: "not-yours",
	},
	"install-token-expired": {
		installationId: "demo-inst-token",
		state: "token-expired",
	},
} satisfies Record<DevRecoveryInstall, RecoveryPlan>;

const TEAM_ROLES = {
	owner: null,
	member: "member",
	moderator: "moderator",
	"team-admin": "admin",
	outsider: null,
	anonymous: null,
} satisfies Record<DevAccount, ScenarioPlan["teamRole"]>;

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
		teamRole: TEAM_ROLES[scenario.account],
		repos,
		unclaimed: unclaimedFor(scenario),
		recovery: isRecoveryInstall(scenario.install)
			? RECOVERY_PLANS[scenario.install]
			: null,
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
	const installationId =
		plan.unclaimed?.installationId ?? plan.recovery?.installationId;
	if (!(installationId && seeded.installState)) {
		return null;
	}
	const search = new URLSearchParams({
		installation_id: installationId,
		setup_action: "install",
		state: seeded.installState,
	});
	return `/onboarding/setup?${search.toString()}`;
}
