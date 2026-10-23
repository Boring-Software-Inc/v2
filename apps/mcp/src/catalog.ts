import type { AgentScope, OrgRole } from "@tripwire/contracts";

export const TOOL_NAMES = [
	"whoami",
	"setup_status",
	"list_repos",
	"get_install_link",
	"list_rule_catalog",
	"get_repo_rules",
	"set_rule",
	"turn_on_gate",
	"list_workflows",
	"set_workflow_enabled",
	"get_workflow",
	"validate_workflow",
	"apply_workflow",
	"list_runs",
	"get_run",
	"list_moderation_queue",
	"decide_moderation",
	"report_setup_progress",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolSpec {
	scope: AgentScope;
	role: OrgRole | null;
	readOnly: boolean;
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
	whoami: { scope: "tripwire:read", role: null, readOnly: true },
	setup_status: { scope: "tripwire:read", role: "member", readOnly: true },
	list_repos: { scope: "tripwire:read", role: "member", readOnly: true },
	get_install_link: { scope: "tripwire:admin", role: "admin", readOnly: true },
	list_rule_catalog: { scope: "tripwire:read", role: null, readOnly: true },
	get_repo_rules: { scope: "tripwire:read", role: "member", readOnly: true },
	set_rule: { scope: "tripwire:configure", role: "admin", readOnly: false },
	turn_on_gate: { scope: "tripwire:admin", role: "admin", readOnly: false },
	list_workflows: { scope: "tripwire:read", role: "member", readOnly: true },
	set_workflow_enabled: {
		scope: "tripwire:configure",
		role: "admin",
		readOnly: false,
	},
	get_workflow: { scope: "tripwire:read", role: "member", readOnly: true },
	validate_workflow: {
		scope: "tripwire:read",
		role: "member",
		readOnly: true,
	},
	apply_workflow: {
		scope: "tripwire:configure",
		role: "admin",
		readOnly: false,
	},
	list_runs: { scope: "tripwire:read", role: "member", readOnly: true },
	get_run: { scope: "tripwire:read", role: "member", readOnly: true },
	list_moderation_queue: {
		scope: "tripwire:read",
		role: "member",
		readOnly: true,
	},
	decide_moderation: {
		scope: "tripwire:moderate",
		role: "admin",
		readOnly: false,
	},
	report_setup_progress: {
		scope: "tripwire:read",
		role: null,
		readOnly: false,
	},
};

const SKILL_SCOPES: Record<string, AgentScope> = {
	read: "tripwire:read",
	configure: "tripwire:configure",
	moderate: "tripwire:moderate",
	admin: "tripwire:admin",
};

export type ToolSelection =
	| { ok: true; scopes: AgentScope[]; readOnly: boolean }
	| { ok: false; message: string };

function parseList(value: string | null): string[] | null {
	if (value === null) {
		return null;
	}
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

export function selectTools(url: URL): ToolSelection {
	const skills = parseList(url.searchParams.get("skills"));
	const disabled = parseList(url.searchParams.get("disable-skills")) ?? [];
	const readOnlyParam = url.searchParams.get("read_only");
	const readOnly = readOnlyParam === "1" || readOnlyParam === "true";
	const named = [...(skills ?? []), ...disabled];
	const unknown = named.filter((name) => !(name in SKILL_SCOPES));
	if (unknown.length > 0) {
		return {
			ok: false,
			message: `Unknown skills: ${unknown.join(", ")}. Use read, configure, moderate or admin.`,
		};
	}
	if (skills && skills.length === 0) {
		return { ok: false, message: "skills must name at least one skill." };
	}
	const chosen = (skills ?? Object.keys(SKILL_SCOPES)).filter(
		(name) => !disabled.includes(name),
	);
	if (chosen.length === 0) {
		return {
			ok: false,
			message: "disable-skills removed every skill. Keep at least one.",
		};
	}
	const scopes = [
		...new Set(chosen.map((name) => SKILL_SCOPES[name] as AgentScope)),
	];
	if (!scopes.includes("tripwire:read")) {
		scopes.unshift("tripwire:read");
	}
	return { ok: true, scopes, readOnly };
}

export function toolVisible(
	name: ToolName,
	selection: { scopes: AgentScope[]; readOnly: boolean },
): boolean {
	const spec = TOOL_SPECS[name];
	if (name === "report_setup_progress") {
		return true;
	}
	if (selection.readOnly && !spec.readOnly) {
		return false;
	}
	return selection.scopes.includes(spec.scope);
}
