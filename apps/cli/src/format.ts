import pc from "picocolors";
import { z } from "zod";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

export interface Style {
	label(text: string): string;
	good(text: string): string;
	next(text: string): string;
	bad(text: string): string;
}

export const PLAIN: Style = {
	label: (text) => text,
	good: (text) => text,
	next: (text) => text,
	bad: (text) => text,
};

export function styleFor(
	tty: boolean,
	env: Record<string, string | undefined>,
): Style {
	if (!tty || env.NO_COLOR) {
		return PLAIN;
	}
	const colors = pc.createColors(true);
	return {
		label: colors.dim,
		good: colors.green,
		next: colors.yellow,
		bad: colors.red,
	};
}

const LABEL_WIDTH = 10;

export type Row = [label: string, value: string];

export function pairs(rows: Row[], style: Style = PLAIN): string {
	return rows
		.map(([label, value]) => {
			const pad = " ".repeat(Math.max(1, LABEL_WIDTH - label.length));
			const head =
				label === "" ? " ".repeat(LABEL_WIDTH) : `${style.label(label)}${pad}`;
			return `${head}${value}`.trimEnd();
		})
		.join("\n");
}

export function table(
	headers: string[],
	rows: string[][],
	minFirst = 30,
): string {
	const widths = headers.map((header, index) => {
		const longest = Math.max(
			header.length,
			...rows.map((row) => (row[index] ?? "").length),
		);
		const width = longest + 5;
		return index === 0 ? Math.max(minFirst, width) : width;
	});
	const line = (cells: string[]) =>
		cells
			.map((cell, index) =>
				index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0),
			)
			.join("")
			.trimEnd();
	return [line(headers), ...rows.map(line)].join("\n");
}

export function errorLine(message: string, style: Style = PLAIN): string {
	return pairs([["error", message]], {
		...style,
		label: style.bad,
	});
}

export function formatUserCode(code: string): string {
	const bare = code.replace(/[\s-]/g, "").toUpperCase();
	return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : code;
}

function onOff(on: boolean, style: Style): string {
	return on ? style.good("on") : "off";
}

function when(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return iso;
	}
	return date.toISOString().slice(0, 16).replace("T", " ");
}

function shortRepo(fullName: string): string {
	return fullName.slice(fullName.lastIndexOf("/") + 1);
}

const whoamiSchema = z.object({
	user: z
		.object({ name: z.string().nullish(), email: z.string().nullish() })
		.nullish(),
	access: z.object({
		approved: z.boolean(),
		requestAccessUrl: z.string().optional(),
	}),
	orgs: z.array(
		z.object({
			slug: z.string(),
			role: z.string(),
			agentAllowed: z.boolean().optional(),
		}),
	),
});

const NEXT_STEPS: Record<string, string> = {
	install_app: "Install the GitHub App",
	sync_repos: "Wait for repos to sync, then run tripwire status again",
	turn_on_gate: "Turn on the gate. Run tripwire gate on <repo>",
};

const statusSchema = z.object({
	org: z.string(),
	role: z.string().optional(),
	nextStep: z.string(),
	installUrl: z.string().optional(),
	home: z.string().optional(),
});

const reposSchema = z.array(
	z.object({
		name: z.string(),
		gateOn: z.boolean(),
		toReview: z.number(),
		blocked24h: z.number(),
	}),
);

const catalogSchema = z.array(
	z.object({
		ruleId: z.string(),
		name: z.string(),
		optIn: z.boolean().optional(),
	}),
);

const repoRulesSchema = z.array(
	z.object({
		ruleId: z.string(),
		enabled: z.boolean(),
		management: z.string().nullish(),
		cannotRun: z.string().nullish(),
		matches24h: z.number().nullish(),
	}),
);

const workflowsSchema = z.array(
	z.object({
		id: z.string(),
		name: z.string(),
		enabled: z.boolean(),
		triggerKinds: z.array(z.string()).optional(),
	}),
);

const workflowSetSchema = z.object({
	enabled: z.boolean(),
	url: z.string().optional(),
	warnings: z.array(z.object({ message: z.string() })).optional(),
});

const runsSchema = z.array(
	z.object({
		id: z.string(),
		repo: z.string().optional(),
		number: z.number().nullish(),
		status: z.string(),
		verdict: z.string().nullish(),
		createdAt: z.string(),
	}),
);

const runSchema = z.object({
	id: z.string(),
	repo: z.string(),
	number: z.number().nullish(),
	status: z.string(),
	verdict: z.string().nullish(),
	createdAt: z.string(),
	steps: z.array(
		z.object({
			kind: z.string(),
			rule: z.string().nullish(),
			status: z.string(),
			summary: z.string().nullish(),
		}),
	),
	url: z.string().optional(),
});

const queueSchema = z.object({
	items: z.array(
		z.object({
			itemId: z.string(),
			repo: z.string().optional(),
			number: z.number().nullish(),
			actor: z.string().nullish(),
			title: z.string().nullish(),
		}),
	),
	url: z.string().optional(),
});

const decideSchema = z.object({
	done: z.boolean(),
	alreadyDecided: z.boolean().optional(),
	confirmUrl: z.string().optional(),
	forUser: z.string().optional(),
});

const setRuleSchema = z.object({ ruleId: z.string(), enabled: z.boolean() });

const gateSchema = z.object({ repo: z.string(), url: z.string().optional() });

function verdictWord(verdict: string | null | undefined, style: Style): string {
	if (!verdict) {
		return "-";
	}
	if (verdict === "pass") {
		return style.good(verdict);
	}
	if (verdict === "block") {
		return style.bad(verdict);
	}
	return style.next(verdict);
}

type Formatter = (data: JsonValue, style: Style) => string | null;

function using<T>(
	schema: z.ZodType<T>,
	render: (value: T, style: Style) => string,
): Formatter {
	return (data, style) => {
		const parsed = schema.safeParse(data);
		return parsed.success ? render(parsed.data, style) : null;
	};
}

const FORMATTERS: Record<string, Formatter> = {
	whoami: using(whoamiSchema, (value, style) => {
		const user = [value.user?.name, value.user?.email]
			.filter(Boolean)
			.join("  ");
		const orgs = value.orgs.map((org) =>
			org.agentAllowed === false
				? `${org.slug} (${org.role}, not granted)`
				: `${org.slug} (${org.role})`,
		);
		const rows: Row[] = [
			["user", user || "-"],
			[
				"access",
				value.access.approved
					? style.good("approved")
					: style.next("not approved"),
			],
		];
		if (!value.access.approved && value.access.requestAccessUrl) {
			rows.push(["open", value.access.requestAccessUrl]);
		}
		rows.push(["orgs", orgs[0] ?? "none"]);
		for (const org of orgs.slice(1)) {
			rows.push(["", org]);
		}
		return pairs(rows, style);
	}),
	setup_status: using(statusSchema, (value, style) => {
		const rows: Row[] = [["org", value.org]];
		if (value.nextStep === "done") {
			rows.push(["done", style.good("Tripwire checks pull requests")]);
		} else if (value.nextStep === "install_app" && !value.installUrl) {
			rows.push([
				"next",
				style.next(`Ask an admin of ${value.org} to install the GitHub App`),
			]);
		} else {
			rows.push([
				"next",
				style.next(NEXT_STEPS[value.nextStep] ?? value.nextStep),
			]);
		}
		if (value.installUrl) {
			rows.push(["open", value.installUrl]);
		}
		return pairs(rows, style);
	}),
	list_repos: using(reposSchema, (repos, style) => {
		if (repos.length === 0) {
			return "No repos yet. Run tripwire status to see the next step.";
		}
		return table(
			["REPO", "GATE", "TO REVIEW", "BLOCKED 24H"],
			repos.map((repo) => [
				repo.name,
				onOff(repo.gateOn, style),
				String(repo.toReview),
				String(repo.blocked24h),
			]),
		);
	}),
	list_rule_catalog: using(catalogSchema, (rules) =>
		table(
			["RULE", "NAME", "OPT-IN"],
			rules.map((rule) => [rule.ruleId, rule.name, rule.optIn ? "yes" : "no"]),
		),
	),
	get_repo_rules: using(repoRulesSchema, (rules, style) => {
		if (rules.length === 0) {
			return "No rules on this repo.";
		}
		return table(
			["RULE", "STATE", "MATCHES 24H", "NOTE"],
			rules.map((rule) => [
				rule.ruleId,
				onOff(rule.enabled, style),
				String(rule.matches24h ?? 0),
				rule.cannotRun ??
					(rule.management === "managed" ? "set by a workflow" : ""),
			]),
		);
	}),
	set_rule: using(setRuleSchema, (value, style) =>
		pairs(
			[["done", `${value.ruleId} is ${onOff(value.enabled, style)}`]],
			style,
		),
	),
	turn_on_gate: using(gateSchema, (value, style) => {
		const rows: Row[] = [
			["done", `Gate is ${style.good("on")} for ${value.repo}`],
		];
		if (value.url) {
			rows.push(["open", value.url]);
		}
		return pairs(rows, style);
	}),
	list_workflows: using(workflowsSchema, (workflows, style) => {
		if (workflows.length === 0) {
			return "No workflows on this repo.";
		}
		return table(
			["WORKFLOW", "ID", "STATE", "TRIGGERS"],
			workflows.map((workflow) => [
				workflow.name,
				workflow.id,
				onOff(workflow.enabled, style),
				(workflow.triggerKinds ?? []).join(", "),
			]),
		);
	}),
	set_workflow_enabled: using(workflowSetSchema, (value, style) => {
		const rows: Row[] = [
			["done", `Workflow is ${onOff(value.enabled, style)}`],
		];
		for (const warning of value.warnings ?? []) {
			rows.push(["warning", warning.message]);
		}
		if (value.url) {
			rows.push(["open", value.url]);
		}
		return pairs(rows, style);
	}),
	list_runs: using(runsSchema, (runs, style) => {
		if (runs.length === 0) {
			return "No runs yet.";
		}
		return table(
			["RUN", "REPO", "PR", "STATUS", "VERDICT", "CREATED"],
			runs.map((run) => [
				run.id,
				run.repo ? shortRepo(run.repo) : "-",
				run.number ? `#${run.number}` : "-",
				run.status,
				verdictWord(run.verdict, style),
				when(run.createdAt),
			]),
		);
	}),
	get_run: using(runSchema, (run, style) => {
		const rows: Row[] = [
			["run", run.id],
			["repo", run.number ? `${run.repo} #${run.number}` : run.repo],
			["status", run.status],
			["verdict", verdictWord(run.verdict, style)],
			["created", when(run.createdAt)],
		];
		if (run.url) {
			rows.push(["open", run.url]);
		}
		const head = pairs(rows, style);
		if (run.steps.length === 0) {
			return head;
		}
		const steps = table(
			["STEP", "STATUS", "SUMMARY"],
			run.steps.map((step) => [
				step.rule ?? step.kind,
				step.status === "fail" ? style.bad(step.status) : step.status,
				step.summary ?? "",
			]),
			20,
		);
		return `${head}\n\n${steps}`;
	}),
	list_moderation_queue: using(queueSchema, (queue) => {
		if (queue.items.length === 0) {
			return "Nothing to review.";
		}
		return table(
			["ITEM", "REPO", "PR", "AUTHOR", "TITLE"],
			queue.items.map((item) => [
				item.itemId,
				item.repo ? shortRepo(item.repo) : "-",
				item.number ? `#${item.number}` : "-",
				item.actor ?? "-",
				item.title ?? "",
			]),
		);
	}),
	decide_moderation: using(decideSchema, (value, style) => {
		if (value.confirmUrl) {
			return pairs(
				[
					["open", value.confirmUrl],
					["", value.forUser ?? "Open this link to confirm."],
				],
				style,
			);
		}
		return pairs(
			[["done", value.done ? style.good("Decided") : "Already decided"]],
			style,
		);
	}),
};

export function formatResult(
	tool: string,
	data: JsonValue | null,
	style: Style = PLAIN,
): string | null {
	const formatter = FORMATTERS[tool];
	if (!(formatter && data !== null)) {
		return null;
	}
	return formatter(data, style);
}

const CLI_HINTS: Record<string, string> = {
	list_orgs: "Run tripwire whoami to see your orgs.",
	pick_org: "Pass --org <slug>, or run tripwire whoami to see them.",
	list_repos: "Run tripwire repos to see them.",
	list_runs: "Run tripwire runs list to see recent runs.",
	list_queue: "Run tripwire queue list to see the items.",
	list_rules: "Run tripwire rules list to see the rules.",
	list_workflows: "Run tripwire workflows list <repo> to see them.",
};

const toolErrorSchema = z.object({
	error: z.string(),
	hint: z.string().optional(),
});

function validationMessage(detail: string): string {
	const missing: string[] = [];
	const invalid: string[] = [];
	for (const line of detail.split("\n")) {
		const match = /^(.*) at ([\w.[\]]+)$/.exec(line.trim());
		if (!match) {
			continue;
		}
		const [, problem = "", path = ""] = match;
		if (/received undefined/.test(problem)) {
			missing.push(path);
		} else {
			invalid.push(`${path} (${problem.replace(/^Invalid input: /, "")})`);
		}
	}
	if (missing.length > 0) {
		return `Missing argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`;
	}
	if (invalid.length > 0) {
		return `Invalid argument${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}.`;
	}
	return "Invalid arguments.";
}

export function friendlyError(
	text: string,
	data: JsonValue | null = null,
): string {
	const structured = toolErrorSchema.safeParse(data);
	if (structured.success) {
		const hint = structured.data.hint
			? CLI_HINTS[structured.data.hint]
			: undefined;
		return hint ? `${structured.data.error} ${hint}` : structured.data.error;
	}
	const bare = text.replace(/^MCP error -?\d+:\s*/, "").trim();
	const validation =
		/^Input validation error: Invalid arguments for tool [\w-]+: ([\s\S]*)$/.exec(
			bare,
		);
	if (validation) {
		return validationMessage(validation[1] ?? "");
	}
	if (/^Tool [\w-]+ (not found|disabled)$/.test(bare)) {
		return "This Tripwire server does not support this command, or your sign-in does not allow it.";
	}
	const cleaned = bare.replace(/\s*Call [a-z_]+\b[^.]*\./g, "").trim();
	return cleaned || "The Tripwire server returned an error.";
}
