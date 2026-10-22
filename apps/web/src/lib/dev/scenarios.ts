import { z } from "zod";

export const DEV_ACCOUNTS = [
	"owner",
	"member",
	"outsider",
	"anonymous",
] as const;
export const DEV_INSTALLS = [
	"none",
	"request-pending",
	"request-approved",
	"awaiting-confirmation",
	"syncing",
	"connected",
] as const;
export const DEV_REPOS = ["none", "empty", "one", "many", "active"] as const;
export const DEV_WORKFLOWS = ["none", "off", "live", "issues"] as const;
export const DEV_LANDINGS = [
	"home",
	"repo",
	"workflows",
	"workflow",
	"settings",
	"install-setup",
	"public-run",
] as const;
export const DEV_LATENCIES = [0, 400, 1500, 4000] as const;

export const devScenarioSchema = z.object({
	account: z.enum(DEV_ACCOUNTS),
	install: z.enum(DEV_INSTALLS),
	repos: z.enum(DEV_REPOS),
	workflows: z.enum(DEV_WORKFLOWS),
	landing: z.enum(DEV_LANDINGS),
});

export type DevScenario = z.infer<typeof devScenarioSchema>;
export type DevAccount = DevScenario["account"];
export type DevInstall = DevScenario["install"];
export type DevRepos = DevScenario["repos"];
export type DevWorkflows = DevScenario["workflows"];
export type DevLanding = DevScenario["landing"];
export type DevLatency = (typeof DEV_LATENCIES)[number];
export type DevAxis = keyof DevScenario;

export const DEV_AXES: readonly DevAxis[] = [
	"account",
	"install",
	"repos",
	"workflows",
	"landing",
];

export const DEV_AXIS_LABELS = {
	account: "Account",
	install: "Install",
	repos: "Repos",
	workflows: "Workflows",
	landing: "Open",
} satisfies Record<DevAxis, string>;

export type DevOptionMap = {
	readonly [A in DevAxis]: readonly DevScenario[A][];
};

export const DEV_OPTIONS: DevOptionMap = {
	account: DEV_ACCOUNTS,
	install: DEV_INSTALLS,
	repos: DEV_REPOS,
	workflows: DEV_WORKFLOWS,
	landing: DEV_LANDINGS,
};

export type DevOptionLabelMap = {
	[A in DevAxis]: Record<DevScenario[A], string>;
};

export const DEV_OPTION_LABELS: DevOptionLabelMap = {
	account: {
		owner: "Org owner",
		member: "Member, not admin",
		outsider: "Signed in, outside the org",
		anonymous: "Signed out",
	},
	install: {
		none: "Not installed",
		"request-pending": "Install request pending",
		"request-approved": "Install request approved",
		"awaiting-confirmation": "Waiting for confirmation",
		syncing: "Syncing repos",
		connected: "Connected",
	},
	repos: {
		none: "No repos",
		empty: "One repo, no events",
		one: "One repo",
		many: "Several repos",
		active: "Busy repo",
	},
	workflows: {
		none: "No workflows",
		off: "Saved, off",
		live: "Live",
		issues: "Has issues",
	},
	landing: {
		home: "Org home",
		repo: "Repo dashboard",
		workflows: "Workflows list",
		workflow: "Workflow editor",
		settings: "Org settings",
		"install-setup": "Install confirmation",
		"public-run": "Public run",
	},
};

export const DEV_LATENCY_LABELS = {
	0: "No delay",
	400: "400ms",
	1500: "1.5s",
	4000: "4s",
} satisfies Record<DevLatency, string>;

const NO_REPO_INSTALLS: readonly DevInstall[] = [
	"none",
	"request-pending",
	"request-approved",
	"awaiting-confirmation",
	"syncing",
];

const SETUP_INSTALLS: readonly DevInstall[] = [
	"request-pending",
	"request-approved",
	"awaiting-confirmation",
	"syncing",
];

type Guard<A extends DevAxis> = (
	value: DevScenario[A],
	state: DevScenario,
) => string | null;

type GuardMap = { [A in DevAxis]: Guard<A> };

const GUARDS: GuardMap = {
	account: () => null,
	install: (value, state) => {
		if (state.account === "anonymous" && value !== "none") {
			return "Signed out has no org";
		}
		if (
			(state.account === "member" || state.account === "outsider") &&
			value !== "connected"
		) {
			return "This account views a team org that is already connected";
		}
		return null;
	},
	repos: (value, state) => {
		if (NO_REPO_INSTALLS.includes(state.install) && value !== "none") {
			return "Repos need a connected install";
		}
		if (state.install === "connected" && value === "none") {
			return "A connected install has at least one repo";
		}
		return null;
	},
	workflows: (value, state) => {
		if (state.repos === "none" && value !== "none") {
			return "Workflows need a repo";
		}
		if (state.account === "outsider" && value !== "none") {
			return "Outsiders can't see workflows";
		}
		return null;
	},
	landing: (value, state) => {
		if (state.account === "anonymous" && value !== "public-run") {
			return "Signed out only sees public runs";
		}
		if ((value === "repo" || value === "workflows") && state.repos === "none") {
			return "Needs a repo";
		}
		if (value === "workflows" && state.account === "outsider") {
			return "Outsiders can't see workflows";
		}
		if (value === "workflow" && state.workflows === "none") {
			return "Needs a workflow";
		}
		if (value === "settings" && state.account === "outsider") {
			return "Outsiders can't open org settings";
		}
		if (value === "install-setup" && !SETUP_INSTALLS.includes(state.install)) {
			return "Needs an install request or an install waiting to connect";
		}
		return null;
	},
};

export function blockedReason<A extends DevAxis>(
	state: DevScenario,
	axis: A,
	value: DevScenario[A],
): string | null {
	return GUARDS[axis](value, state);
}

function settle<A extends DevAxis>(state: DevScenario, axis: A): DevScenario {
	if (blockedReason(state, axis, state[axis]) === null) {
		return state;
	}
	const options: readonly DevScenario[A][] = DEV_OPTIONS[axis];
	const allowed = options.find(
		(option) => blockedReason(state, axis, option) === null,
	);
	return allowed === undefined ? state : { ...state, [axis]: allowed };
}

export function normalizeScenario(state: DevScenario): DevScenario {
	return DEV_AXES.reduce<DevScenario>(
		(next, axis) => settle(next, axis),
		state,
	);
}

export function transitionScenario<A extends DevAxis>(
	state: DevScenario,
	axis: A,
	value: DevScenario[A],
): DevScenario {
	return normalizeScenario({ ...state, [axis]: value });
}

export interface DevPreset {
	id: string;
	label: string;
	group: string;
	keywords: readonly string[];
	scenario: DevScenario;
	latency: DevLatency;
}

function preset(
	id: string,
	label: string,
	group: string,
	scenario: DevScenario,
	options: { keywords?: readonly string[]; latency?: DevLatency } = {},
): DevPreset {
	return {
		id,
		label,
		group,
		keywords: options.keywords ?? [],
		scenario: normalizeScenario(scenario),
		latency: options.latency ?? 0,
	};
}

const OWNER_HOME: DevScenario = {
	account: "owner",
	install: "connected",
	repos: "active",
	workflows: "off",
	landing: "home",
};

export const DEV_PRESETS: readonly DevPreset[] = [
	preset("active", "Busy dashboard", "Accounts", OWNER_HOME, {
		keywords: ["default", "active"],
	}),
	preset(
		"fresh",
		"Fresh maintainer",
		"Accounts",
		{ ...OWNER_HOME, install: "none", repos: "none", workflows: "none" },
		{ keywords: ["new", "empty", "connect"] },
	),
	preset(
		"one-repo",
		"One repo",
		"Accounts",
		{ ...OWNER_HOME, repos: "one" },
		{ keywords: ["single"] },
	),
	preset("many-repos", "Several repos", "Accounts", {
		...OWNER_HOME,
		repos: "many",
	}),
	preset(
		"empty",
		"Repo with no events",
		"Accounts",
		{ ...OWNER_HOME, repos: "empty", workflows: "none" },
		{ keywords: ["empty states"] },
	),
	preset(
		"anonymous",
		"Stranger on a public run",
		"Accounts",
		{
			account: "anonymous",
			install: "none",
			repos: "none",
			workflows: "none",
			landing: "public-run",
		},
		{ keywords: ["signed out", "public", "og"] },
	),
	preset(
		"member",
		"Member, not admin",
		"Accounts",
		{ ...OWNER_HOME, account: "member", repos: "one", workflows: "live" },
		{ keywords: ["role", "permissions", "read only"] },
	),
	preset(
		"outsider",
		"Signed in outsider",
		"Accounts",
		{
			...OWNER_HOME,
			account: "outsider",
			repos: "one",
			workflows: "none",
			landing: "repo",
		},
		{ keywords: ["non member", "redaction", "leak"] },
	),
	preset(
		"install-request-pending",
		"Install request pending",
		"Onboarding",
		{
			...OWNER_HOME,
			install: "request-pending",
			repos: "none",
			workflows: "none",
			landing: "install-setup",
		},
		{ keywords: ["approval", "github admin"] },
	),
	preset("install-request-approved", "Install request approved", "Onboarding", {
		...OWNER_HOME,
		install: "request-approved",
		repos: "none",
		workflows: "none",
	}),
	preset(
		"install-confirmation",
		"Install confirmation",
		"Onboarding",
		{
			...OWNER_HOME,
			install: "awaiting-confirmation",
			repos: "none",
			workflows: "none",
			landing: "install-setup",
		},
		{ keywords: ["connect github", "claim", "setup"] },
	),
	preset(
		"install-syncing",
		"Install still syncing",
		"Onboarding",
		{
			...OWNER_HOME,
			install: "syncing",
			repos: "none",
			workflows: "none",
			landing: "install-setup",
		},
		{ keywords: ["background", "sync"] },
	),
	preset(
		"forge-loading",
		"Forge buttons loading",
		"Loading",
		{ ...OWNER_HOME, install: "none", repos: "none", workflows: "none" },
		{ keywords: ["connect repos", "flash", "spinner"], latency: 1500 },
	),
	preset(
		"home-loading",
		"Home loading",
		"Loading",
		{ ...OWNER_HOME, repos: "one" },
		{ keywords: ["skeleton", "spinner"], latency: 1500 },
	),
	preset("workflows-off", "Workflows, all off", "Workflows", {
		...OWNER_HOME,
		landing: "workflows",
	}),
	preset("workflows-live", "Workflows, live", "Workflows", {
		...OWNER_HOME,
		workflows: "live",
		landing: "workflows",
	}),
	preset(
		"workflow-issues",
		"Workflow with issues",
		"Workflows",
		{ ...OWNER_HOME, workflows: "issues", landing: "workflow" },
		{ keywords: ["invalid", "gate", "request review", "connections"] },
	),
	preset(
		"workflow-editor",
		"Workflow editor",
		"Workflows",
		{ ...OWNER_HOME, landing: "workflow" },
		{ keywords: ["ports", "block merge", "properties"] },
	),
	preset(
		"member-workflows",
		"Workflows as a member",
		"Workflows",
		{
			...OWNER_HOME,
			account: "member",
			repos: "one",
			workflows: "live",
			landing: "workflows",
		},
		{ keywords: ["read only", "admins"] },
	),
	preset(
		"settings-owner",
		"Org settings",
		"Settings",
		{ ...OWNER_HOME, landing: "settings" },
		{ keywords: ["sheet", "general", "members"] },
	),
	preset("settings-member", "Org settings as a member", "Settings", {
		...OWNER_HOME,
		account: "member",
		repos: "one",
		workflows: "live",
		landing: "settings",
	}),
];

export const DEFAULT_PRESET_ID = "active";

export function getPreset(id: string): DevPreset | undefined {
	return DEV_PRESETS.find((candidate) => candidate.id === id);
}

export function searchPresets(query: string): DevPreset[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) {
		return [...DEV_PRESETS];
	}
	return DEV_PRESETS.filter((candidate) => {
		const haystack = [
			candidate.label,
			candidate.group,
			candidate.id,
			...candidate.keywords,
		]
			.join(" ")
			.toLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
}

export function sameScenario(a: DevScenario, b: DevScenario): boolean {
	return DEV_AXES.every((axis) => a[axis] === b[axis]);
}

export const DEV_LATENCY_COOKIE = "tw-dev-latency";
export const DEV_LATENCY_MAX_MS = 10_000;

export function devLatencyMs(raw: string | undefined): number {
	const parsed = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 0;
	}
	return Math.min(parsed, DEV_LATENCY_MAX_MS);
}
