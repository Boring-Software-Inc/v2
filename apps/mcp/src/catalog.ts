import type { AgentScope, OrgPermission } from "@tripwire/contracts";

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
	"begin_workflow_work",
	"finish_workflow_work",
	"propose_workflow_push",
	"get_workflow_push",
	"list_runs",
	"get_run",
	"list_moderation_queue",
	"decide_moderation",
	"report_setup_progress",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolNeed = "none" | "org-shell" | OrgPermission;

export interface ToolSpec {
	scope: AgentScope;
	need: ToolNeed;
	readOnly: boolean;
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
	whoami: { scope: "tripwire:read", need: "none", readOnly: true },
	setup_status: { scope: "tripwire:read", need: "org-shell", readOnly: true },
	list_repos: { scope: "tripwire:read", need: "org-shell", readOnly: true },
	get_install_link: {
		scope: "tripwire:admin",
		need: "connections:manage",
		readOnly: true,
	},
	list_rule_catalog: { scope: "tripwire:read", need: "none", readOnly: true },
	get_repo_rules: {
		scope: "tripwire:read",
		need: "rules:read",
		readOnly: true,
	},
	set_rule: {
		scope: "tripwire:configure",
		need: "rules:manage",
		readOnly: false,
	},
	turn_on_gate: {
		scope: "tripwire:admin",
		need: "connections:manage",
		readOnly: false,
	},
	list_workflows: {
		scope: "tripwire:read",
		need: "workflows:read",
		readOnly: true,
	},
	set_workflow_enabled: {
		scope: "tripwire:configure",
		need: "workflows:manage",
		readOnly: false,
	},
	get_workflow: {
		scope: "tripwire:read",
		need: "workflows:read",
		readOnly: true,
	},
	validate_workflow: {
		scope: "tripwire:read",
		need: "workflows:read",
		readOnly: true,
	},
	apply_workflow: {
		scope: "tripwire:configure",
		need: "workflows:manage",
		readOnly: false,
	},
	begin_workflow_work: {
		scope: "tripwire:configure",
		need: "workflows:manage",
		readOnly: false,
	},
	finish_workflow_work: {
		scope: "tripwire:configure",
		need: "workflows:manage",
		readOnly: false,
	},
	propose_workflow_push: {
		scope: "tripwire:configure",
		need: "workflows:manage",
		readOnly: false,
	},
	get_workflow_push: {
		scope: "tripwire:read",
		need: "workflows:read",
		readOnly: true,
	},
	list_runs: { scope: "tripwire:read", need: "activity:read", readOnly: true },
	get_run: { scope: "tripwire:read", need: "activity:read", readOnly: true },
	list_moderation_queue: {
		scope: "tripwire:read",
		need: "moderation:read",
		readOnly: true,
	},
	decide_moderation: {
		scope: "tripwire:moderate",
		need: "moderation:manage",
		readOnly: false,
	},
	report_setup_progress: {
		scope: "tripwire:read",
		need: "none",
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

export interface ToolVisibility {
	scopes: AgentScope[];
	readOnly: boolean;
	permissions?: readonly OrgPermission[];
}

export function toolVisible(
	name: ToolName,
	selection: ToolVisibility,
): boolean {
	const spec = TOOL_SPECS[name];
	if (name === "report_setup_progress") {
		return true;
	}
	if (selection.readOnly && !spec.readOnly) {
		return false;
	}
	if (
		selection.permissions &&
		spec.need !== "none" &&
		spec.need !== "org-shell" &&
		!selection.permissions.includes(spec.need)
	) {
		return false;
	}
	return selection.scopes.includes(spec.scope);
}
