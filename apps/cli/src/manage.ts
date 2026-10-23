import {
	type CompileIssue,
	compileIssueText,
	reportWorkflows,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import type { Command } from "commander";
import { z } from "zod";
import { type Credential, credentialStore } from "#/auth/credentials";
import {
	type AuthDeps,
	pollForToken,
	requestDeviceCode,
	revokeCredential,
} from "#/auth/device";
import { loadSession } from "#/auth/session";
import { authUrl, mcpUrl } from "#/config";
import {
	decisionChoiceError,
	errorLine,
	formatResult,
	formatUserCode,
	friendlyError,
	pairs,
	type Style,
	styleFor,
	warnLine,
} from "#/format";
import { callTool, type ToolArgs, type ToolOutput } from "#/mcp-client";
import type { System } from "#/system";
import {
	DEFAULT_WORKFLOW_FILE,
	formatReports,
	loadWorkflowFile,
	localCatalog,
	pulledCountText,
	pulledDefinitions,
	type ReportView,
	writePulled,
} from "#/workflows-code";

export interface ManageDeps {
	system: System;
	auth: AuthDeps;
	fetch?: typeof fetch;
	openUrl?(url: string): Promise<void>;
}

interface GlobalOptions {
	json: boolean;
	org?: string;
	style: Style;
	errStyle: Style;
}

type JsonValue = z.infer<ReturnType<typeof z.json>>;

const globalsSchema = z.object({
	json: z.boolean().optional(),
	org: z.string().optional(),
});

const whoamiNameSchema = z.looseObject({
	user: z.looseObject({
		name: z.string().nullish(),
		email: z.string().nullish(),
	}),
});

const NAME_RETRY_MS = 1000;

function globals(command: Command, system: System): GlobalOptions {
	const parsed = globalsSchema.parse(command.optsWithGlobals());
	const org = parsed.org ?? system.env.TRIPWIRE_ORG;
	return {
		json: parsed.json === true,
		org,
		style: styleFor(process.stdout.isTTY === true, system.env),
		errStyle: styleFor(process.stderr.isTTY === true, system.env),
	};
}

function out(text: string): void {
	process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function err(text: string): void {
	process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}

function parseParam(pair: string): [string, JsonValue] {
	const index = pair.indexOf("=");
	if (index <= 0) {
		throw new Error(`Expected key=value, got ${pair}`);
	}
	const key = pair.slice(0, index);
	const raw = pair.slice(index + 1);
	try {
		const parsed = z.json().safeParse(JSON.parse(raw));
		return [key, parsed.success ? parsed.data : raw];
	} catch {
		return [key, raw];
	}
}

function render(
	tool: string,
	output: ToolOutput,
	options: GlobalOptions,
): number {
	if (options.json) {
		const body = output.isError
			? { error: output.text }
			: (output.data ?? { text: output.text });
		out(JSON.stringify(body, null, 2));
		return output.isError ? 1 : 0;
	}
	if (output.isError) {
		err(errorLine(friendlyError(output.text, output.data), options.errStyle));
		return 1;
	}
	out(
		formatResult(tool, output.data, options.style) ??
			(output.text || JSON.stringify(output.data, null, 2)),
	);
	return 0;
}

function fail(error: Error, options: GlobalOptions): number {
	if (options.json) {
		out(JSON.stringify({ error: error.message }, null, 2));
	} else {
		err(errorLine(friendlyError(error.message), options.errStyle));
	}
	return 1;
}

function withOrg(options: GlobalOptions, args: ToolArgs): ToolArgs {
	return options.org ? { org: options.org, ...args } : args;
}

async function runTool(
	deps: ManageDeps,
	command: Command,
	name: string,
	args: ToolArgs,
): Promise<void> {
	const options = globals(command, deps.system);
	try {
		const session = await loadSession(deps.system, deps.auth);
		const output = await callTool(
			session,
			name,
			withOrg(options, args),
			deps.fetch,
		);
		process.exitCode = render(name, output, options);
	} catch (error) {
		process.exitCode = fail(
			error instanceof Error ? error : new Error(String(error)),
			options,
		);
	}
}

async function login(deps: ManageDeps, command: Command): Promise<void> {
	const options = globals(command, deps.system);
	const browser = command.opts<{ browser: boolean }>().browser;
	const base = authUrl(deps.system.env);
	const resource = mcpUrl(deps.system.env);
	try {
		const code = await requestDeviceCode(deps.auth, base, resource);
		const link = code.verification_uri_complete ?? code.verification_uri;
		err(
			pairs(
				[
					["code", formatUserCode(code.user_code)],
					["open", link],
					["", "Waiting for you to allow it in the browser"],
				],
				options.errStyle,
			),
		);
		if (browser && deps.openUrl) {
			await deps.openUrl(link).catch(() => undefined);
		}
		const credential = await pollForToken(deps.auth, base, resource, code);
		const where = await save(deps.system, credential);
		if (options.json) {
			out(JSON.stringify({ signedIn: true, store: where }, null, 2));
		} else {
			const name = await signedInName(deps, credential);
			out(
				pairs(
					[["done", name ? `Signed in as ${name}` : "Signed in"]],
					options.style,
				),
			);
		}
	} catch (error) {
		process.exitCode = fail(
			error instanceof Error ? error : new Error(String(error)),
			options,
		);
	}
}

async function whoamiName(
	deps: ManageDeps,
	credential: Credential,
): Promise<string | null> {
	try {
		const output = await callTool(
			{
				token: credential.accessToken,
				mcpUrl: deps.system.env.TRIPWIRE_MCP_URL || credential.mcpUrl,
				source: "file",
			},
			"whoami",
			{},
			deps.fetch,
		);
		const parsed = whoamiNameSchema.safeParse(output.data);
		if (!parsed.success) {
			return null;
		}
		const { name, email } = parsed.data.user;
		return name?.trim() || email?.trim() || null;
	} catch {
		return null;
	}
}

async function signedInName(
	deps: ManageDeps,
	credential: Credential,
): Promise<string | null> {
	const first = await whoamiName(deps, credential);
	if (first) {
		return first;
	}
	await deps.auth.sleep(NAME_RETRY_MS);
	return await whoamiName(deps, credential);
}

async function save(system: System, credential: Credential): Promise<string> {
	const store = credentialStore(system);
	try {
		await store.write(credential);
		return store.location;
	} catch {
		const fallback = credentialStore({
			...system,
			env: { ...system.env, TRIPWIRE_CREDENTIAL_STORE: "file" },
		});
		await fallback.write(credential);
		return fallback.location;
	}
}

async function logout(deps: ManageDeps, command: Command): Promise<void> {
	const options = globals(command, deps.system);
	const store = credentialStore(deps.system);
	const credential = await store.read();
	if (credential) {
		await revokeCredential(deps.auth, credential);
	}
	await store.clear();
	if (options.json) {
		out(JSON.stringify({ signedIn: false }, null, 2));
	} else {
		out(
			pairs(
				[["done", credential ? "Signed out" : "Not signed in"]],
				options.style,
			),
		);
	}
}

interface WorkflowFileOptions {
	file: string;
}

const changeListSchema = z.object({
	workflows: z.array(
		z.object({
			id: z.string(),
			valid: z.boolean().optional(),
			outcome: z.string().optional(),
			url: z.string().optional(),
			enabled: z.boolean().optional(),
			issues: z
				.array(
					z.union([
						z.string(),
						z
							.object({
								step: z.string(),
								message: z.string(),
								severity: z.string().optional(),
							})
							.transform((issue) =>
								issue.severity === "warning"
									? ""
									: `${issue.step}: ${issue.message}`,
							),
					]),
				)
				.optional(),
			changes: z
				.array(
					z.object({
						change: z.enum(["added", "removed", "changed"]),
						subject: z.string(),
						text: z.string(),
					}),
				)
				.optional(),
		}),
	),
});

const CHANGE_MARK = { added: "+", removed: "-", changed: "~" } as const;

type ChangeEntry = z.infer<typeof changeListSchema>["workflows"][number];

function blockingReasons(entry: ChangeEntry): string {
	return (entry.issues ?? []).filter(Boolean).join(" ");
}

function changeLines(
	data: JsonValue | null,
	style: Style,
	describe: (
		entry: z.infer<typeof changeListSchema>["workflows"][number],
	) => string,
): string {
	const parsed = changeListSchema.safeParse(data);
	if (!parsed.success) {
		return JSON.stringify(data, null, 2);
	}
	return parsed.data.workflows
		.map((entry) => {
			const changes = entry.changes ?? [];
			const lines = changes.map(
				(change) =>
					`  ${CHANGE_MARK[change.change]} ${change.subject} ${change.text}`,
			);
			return [style.label(describe(entry)), ...lines].join("\n");
		})
		.join("\n\n");
}

function compileIssueLines(
	issues: readonly CompileIssue[],
	options: GlobalOptions,
): string {
	return issues
		.map((issue) => errorLine(compileIssueText(issue), options.errStyle))
		.join("\n");
}

async function compileFile(
	file: string,
	options: GlobalOptions,
): Promise<WorkflowDefinition[] | null> {
	const compiled = await loadWorkflowFile(file);
	if (compiled.ok) {
		return compiled.definitions;
	}
	if (options.json) {
		out(JSON.stringify({ valid: false, issues: compiled.issues }, null, 2));
	} else {
		err(compileIssueLines(compiled.issues, options));
	}
	return null;
}

async function callForData(
	deps: ManageDeps,
	options: GlobalOptions,
	name: string,
	args: ToolArgs,
): Promise<ToolOutput> {
	const session = await loadSession(deps.system, deps.auth);
	return await callTool(session, name, withOrg(options, args), deps.fetch);
}

async function workflowAction(
	command: Command,
	deps: ManageDeps,
	body: (options: GlobalOptions) => Promise<number>,
): Promise<void> {
	const options = globals(command, deps.system);
	try {
		process.exitCode = await body(options);
	} catch (error) {
		process.exitCode = fail(
			error instanceof Error ? error : new Error(String(error)),
			options,
		);
	}
}

function pullWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	workflow: string | undefined,
	opts: WorkflowFileOptions & { force?: boolean },
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const args: ToolArgs = { repo };
		if (workflow) {
			args.workflow = workflow;
		}
		const output = await callForData(deps, options, "get_workflow", args);
		if (output.isError) {
			return render("get_workflow", output, options);
		}
		const written = writePulled(
			opts.file,
			pulledDefinitions(output.data),
			opts.force === true,
		);
		if (options.json) {
			out(JSON.stringify(written, null, 2));
			return 0;
		}
		out(
			pairs(
				[
					["wrote", `${written.file} (${pulledCountText(written)})`],
					["helpers", written.module],
					...written.warnings.map((warning): [string, string] => [
						"note",
						warning,
					]),
				],
				options.style,
			),
		);
		return 0;
	});
}

function validateWorkflows(
	deps: ManageDeps,
	command: Command,
	opts: WorkflowFileOptions & { repo?: string },
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const compiled = await loadWorkflowFile(opts.file);
		const issues = compiled.ok ? [] : compiled.issues;
		const { definitions } = compiled;
		let reports: ReportView[] = [];
		if (definitions.length > 0 && opts.repo) {
			const output = await callForData(deps, options, "validate_workflow", {
				repo: opts.repo,
				definitions: definitionsJson(definitions),
			});
			if (output.isError || (options.json && issues.length === 0)) {
				if (issues.length > 0) {
					err(compileIssueLines(issues, options));
				}
				return render("validate_workflow", output, options);
			}
			reports = reportsSchema.parse(output.data).workflows;
		} else if (definitions.length > 0) {
			reports = reportWorkflows(definitions, localCatalog(definitions));
		}
		const valid =
			issues.length === 0 && reports.every((report) => report.valid);
		if (options.json) {
			out(
				JSON.stringify(
					{
						valid,
						issues,
						workflows: reports,
						definitions: opts.repo ? undefined : definitions,
					},
					null,
					2,
				),
			);
			return valid ? 0 : 1;
		}
		if (issues.length > 0) {
			err(compileIssueLines(issues, options));
		}
		if (reports.length > 0) {
			out(formatReports(reports, options.style));
		}
		return valid ? 0 : 1;
	});
}

function diffWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	opts: WorkflowFileOptions,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const definitions = await compileFile(opts.file, options);
		if (!definitions) {
			return 1;
		}
		const output = await callForData(deps, options, "validate_workflow", {
			repo,
			definitions: definitionsJson(definitions),
		});
		if (options.json || output.isError) {
			return render("validate_workflow", output, options);
		}
		out(
			changeLines(output.data, options.style, (entry) =>
				(entry.changes ?? []).length === 0
					? `${entry.id}: no changes`
					: entry.id,
			),
		);
		const parsed = changeListSchema.safeParse(output.data);
		const blocked = parsed.success
			? parsed.data.workflows.filter((entry) => entry.valid === false)
			: [];
		for (const entry of blocked) {
			const reasons = blockingReasons(entry);
			err(
				warnLine(
					entry.enabled
						? `${entry.id} is on, so a push will be refused. ${reasons}`
						: `${entry.id} could not be turned on after a push. ${reasons}`,
					options.errStyle,
				),
			);
		}
		return 0;
	});
}

function pushWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	opts: WorkflowFileOptions,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const definitions = await compileFile(opts.file, options);
		if (!definitions) {
			return 1;
		}
		const output = await callForData(deps, options, "apply_workflow", {
			repo,
			definitions: definitionsJson(definitions),
		});
		if (options.json || output.isError) {
			return render("apply_workflow", output, options);
		}
		const parsed = changeListSchema.safeParse(output.data);
		out(
			changeLines(output.data, options.style, (entry) =>
				[entry.id, entry.outcome, entry.url].filter(Boolean).join("  "),
			),
		);
		const refused = parsed.success
			? parsed.data.workflows.filter((entry) => entry.outcome === "refused")
			: [];
		for (const entry of refused) {
			const reasons = blockingReasons(entry);
			err(
				errorLine(
					reasons
						? `${entry.id} is on, so this version was not saved. ${reasons}`
						: `${entry.id} is on, so this version was not saved. Run tripwire workflows validate --repo ${repo} to see why.`,
					options.errStyle,
				),
			);
		}
		return refused.length > 0 ? 1 : 0;
	});
}

const reportsSchema = z.object({
	workflows: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			valid: z.boolean(),
			issues: z.array(
				z.object({
					rule: z.string(),
					severity: z.enum(["error", "warning"]),
					step: z.string(),
					message: z.string(),
				}),
			),
			schedules: z.array(
				z.object({
					nodeId: z.string(),
					summary: z.string(),
					timezone: z.string(),
					defaulted: z.boolean(),
					description: z.string().optional(),
				}),
			),
		}),
	),
});

function definitionsJson(definitions: WorkflowDefinition[]): JsonValue {
	return z.json().parse(JSON.parse(JSON.stringify(definitions)));
}

export function registerManageCommands(program: Command, deps: ManageDeps) {
	program
		.command("login")
		.description("Sign in with the OAuth device flow and store the token")
		.option("--no-browser", "Print the link without opening a browser")
		.action((_options, command: Command) => login(deps, command));

	program
		.command("logout")
		.description("Revoke and remove the stored token")
		.action((_options, command: Command) => logout(deps, command));

	program
		.command("whoami")
		.description("Show the signed-in account, access status and orgs")
		.action((_options, command: Command) =>
			runTool(deps, command, "whoami", {}),
		);

	program
		.command("status")
		.description("Show setup status and the next step")
		.action((_options, command: Command) =>
			runTool(deps, command, "setup_status", {}),
		);

	program
		.command("repos")
		.description("List repos and their gate state")
		.action((_options, command: Command) =>
			runTool(deps, command, "list_repos", {}),
		);

	const rules = program.command("rules").description("Read and change rules");
	rules
		.command("list [repo]")
		.description(
			"List a repo's rules, or the rule catalog when no repo is given",
		)
		.action((repo: string | undefined, _options, command: Command) =>
			repo
				? runTool(deps, command, "get_repo_rules", { repo })
				: runTool(deps, command, "list_rule_catalog", {}),
		);
	rules
		.command("set <repo> <ruleId>")
		.description("Turn a rule on or off and set its params")
		.option("--enable", "Turn the rule on")
		.option("--disable", "Turn the rule off")
		.option(
			"--param <key=value>",
			"Set a param, repeatable. Values parse as JSON when they can",
			(value: string, previous: string[]) => [...previous, value],
			[],
		)
		.action(
			(
				repo: string,
				ruleId: string,
				opts: { enable?: boolean; disable?: boolean; param: string[] },
				command: Command,
			) => {
				const args: ToolArgs = { repo, ruleId };
				if (opts.enable || opts.disable) {
					args.enabled = opts.enable === true;
				}
				try {
					if (opts.param.length > 0) {
						args.config = Object.fromEntries(opts.param.map(parseParam));
					}
					if (args.enabled === undefined && args.config === undefined) {
						throw new Error("Pass --enable, --disable or --param.");
					}
				} catch (error) {
					process.exitCode = fail(
						error instanceof Error ? error : new Error(String(error)),
						globals(command, deps.system),
					);
					return;
				}
				return runTool(deps, command, "set_rule", args);
			},
		);

	program
		.command("gate")
		.description("Control the Tripwire gate on a repo")
		.command("on <repo>")
		.description("Turn the gate on for a repo")
		.action((repo: string, _options, command: Command) =>
			runTool(deps, command, "turn_on_gate", { repo }),
		);

	const workflows = program
		.command("workflows")
		.description(
			"Manage workflows as tripwire.ts code: pull, validate, diff and push",
		);
	workflows
		.command("pull <repo> [workflow]")
		.description(
			"Write a repo's workflows to tripwire.ts, with the typed helpers in .tripwire/",
		)
		.option("--file <path>", "Where to write the code", DEFAULT_WORKFLOW_FILE)
		.option("--force", "Replace the file if it has local edits")
		.action(
			(
				repo: string,
				workflow: string | undefined,
				opts: WorkflowFileOptions & { force?: boolean },
				command: Command,
			) => pullWorkflows(deps, command, repo, workflow, opts),
		);
	workflows
		.command("validate")
		.description(
			"Compile tripwire.ts and check it; with --repo, against that repo's rules",
		)
		.option("--file <path>", "The workflow file", DEFAULT_WORKFLOW_FILE)
		.option(
			"--repo <repo>",
			"Also check against this repo, custom rules included",
		)
		.action((opts: WorkflowFileOptions & { repo?: string }, command: Command) =>
			validateWorkflows(deps, command, opts),
		);
	workflows
		.command("diff <repo>")
		.description("Show what a push of tripwire.ts would change on the repo")
		.option("--file <path>", "The workflow file", DEFAULT_WORKFLOW_FILE)
		.action((repo: string, opts: WorkflowFileOptions, command: Command) =>
			diffWorkflows(deps, command, repo, opts),
		);
	workflows
		.command("push <repo>")
		.description(
			"Save tripwire.ts to the repo. New workflows start off; enable them when ready",
		)
		.option("--file <path>", "The workflow file", DEFAULT_WORKFLOW_FILE)
		.action((repo: string, opts: WorkflowFileOptions, command: Command) =>
			pushWorkflows(deps, command, repo, opts),
		);
	workflows
		.command("list <repo>")
		.description("List a repo's workflows")
		.action((repo: string, _options, command: Command) =>
			runTool(deps, command, "list_workflows", { repo }),
		);
	for (const verb of ["enable", "disable"] as const) {
		workflows
			.command(`${verb} <repo> <workflowId>`)
			.description(`${verb === "enable" ? "Enable" : "Disable"} a workflow`)
			.action((repo: string, workflowId: string, _options, command: Command) =>
				runTool(deps, command, "set_workflow_enabled", {
					repo,
					workflowId,
					enabled: verb === "enable",
				}),
			);
	}

	const runs = program.command("runs").description("Inspect runs");
	runs
		.command("list")
		.description("List recent runs")
		.option("--repo <repo>", "Only runs for this repo")
		.option("--limit <n>", "How many runs to show", (value) =>
			Number.parseInt(value, 10),
		)
		.action((opts: { repo?: string; limit?: number }, command: Command) => {
			const args: ToolArgs = {};
			if (opts.repo) {
				args.repo = opts.repo;
			}
			if (opts.limit) {
				args.limit = opts.limit;
			}
			return runTool(deps, command, "list_runs", args);
		});
	runs
		.command("show <runId>")
		.description("Show one run with its rule results")
		.action((runId: string, _options, command: Command) =>
			runTool(deps, command, "get_run", { runId }),
		);

	const queue = program
		.command("queue")
		.description("Work the human review queue");
	queue
		.command("list")
		.description("List items waiting for human review")
		.option("--repo <repo>", "Only items for this repo")
		.action((opts: { repo?: string }, command: Command) =>
			runTool(
				deps,
				command,
				"list_moderation_queue",
				opts.repo ? { repo: opts.repo } : {},
			),
		);
	queue
		.command("decide <repo> <itemId> <action>")
		.description(
			"Decide an item: approve, remove or ban. A ban returns a link a human must open",
		)
		.action(
			(
				repo: string,
				itemId: string,
				action: string,
				_options,
				command: Command,
			) => {
				if (!["approve", "remove", "ban"].includes(action)) {
					process.exitCode = fail(
						new Error(decisionChoiceError(action)),
						globals(command, deps.system),
					);
					return;
				}
				return runTool(deps, command, "decide_moderation", {
					repo,
					itemId,
					decision: action,
				});
			},
		);
}
