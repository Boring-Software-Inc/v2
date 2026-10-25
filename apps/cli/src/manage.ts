import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
	type CompileIssue,
	compileIssueText,
	type MatchedWorkflows,
	matchWorkflowIds,
	type NamedWorkflow,
	pushExitCode,
	reportWorkflows,
	ruleOutcomeSchema,
	WORKFLOW_PUSH_STATUS_LABELS,
	type WorkflowDefinition,
	type WorkflowPushView,
	type WorkflowState,
	workflowKeys,
	workflowPushProposalResultSchema,
	workflowPushViewSchema,
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
import { runPicker } from "#/picker";
import {
	type FoundLink,
	findProjectLink,
	InvalidProjectLinkError,
	linkedWorkflowFile,
	type ProjectLink,
	removeProjectLink,
	resolveOrg,
	resolveRepo,
	sameLink,
	workflowMapping,
	writeProjectLink,
} from "#/project-link";
import {
	blockedText,
	canOpenBrowser,
	outcomeText,
	pushRefusalText,
	waitForDecision,
	waitingText,
} from "#/push-review";
import type { System } from "#/system";
import {
	DEFAULT_WORKFLOW_FILE,
	formatReports,
	initialPicks,
	type ListedWorkflow,
	type LocalWorkflows,
	loadWorkflowFile,
	localCatalog,
	type PulledWorkflow,
	pulledCountText,
	pulledWorkflows,
	type ReportView,
	readLocalWorkflows,
	selectPulled,
	workflowChoices,
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
	link: FoundLink | null;
	linkError?: Error;
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

interface LinkLookup {
	link: FoundLink | null;
	linkError?: Error;
}

function nearestLink(): LinkLookup {
	try {
		return { link: findProjectLink(process.cwd()) };
	} catch (error) {
		return {
			link: null,
			linkError: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

function globals(command: Command, system: System): GlobalOptions {
	const parsed = globalsSchema.parse(command.optsWithGlobals());
	const { link, linkError } = nearestLink();
	return {
		json: parsed.json === true,
		org: resolveOrg(parsed.org, system.env.TRIPWIRE_ORG, link),
		link,
		linkError,
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
			? { error: friendlyError(output.text, output.data) }
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
		out(JSON.stringify({ error: friendlyError(error.message) }, null, 2));
	} else {
		err(errorLine(friendlyError(error.message), options.errStyle));
	}
	return 1;
}

function withOrg(options: GlobalOptions, args: ToolArgs): ToolArgs {
	return options.org ? { org: options.org, ...args } : args;
}

function linkedRepo(options: GlobalOptions, explicit?: string): string {
	if (!explicit && options.linkError) {
		throw options.linkError;
	}
	return resolveRepo(explicit, options.link);
}

function withRepo(
	deps: ManageDeps,
	command: Command,
	explicit: string | undefined,
	run: (repo: string) => Promise<void>,
): Promise<void> | undefined {
	const options = globals(command, deps.system);
	try {
		return run(linkedRepo(options, explicit));
	} catch (error) {
		process.exitCode = fail(
			error instanceof Error ? error : new Error(String(error)),
			options,
		);
		return undefined;
	}
}

function linkRows(found: FoundLink): [string, string][] {
	const { org, repo } = found.link;
	return [
		["linked", org ? `${repo} in org ${org}` : repo],
		["file", found.path],
	];
}

function linkedFile(deps: ManageDeps, command: Command, file: string): string {
	return linkedWorkflowFile(
		file,
		command.getOptionValueSource("file") === "default",
		process.cwd(),
		globals(command, deps.system).link,
	);
}

function withLink(
	output: ToolOutput,
	options: GlobalOptions,
	showLink: boolean,
): ToolOutput {
	if (!showLink || !options.link || output.isError) {
		return output;
	}
	const data = z.record(z.string(), z.json()).safeParse(output.data);
	return data.success
		? {
				...output,
				data: {
					...data.data,
					link: { ...options.link.link, path: options.link.path },
				},
			}
		: output;
}

async function runTool(
	deps: ManageDeps,
	command: Command,
	name: string,
	args: ToolArgs,
	showLink = false,
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
		process.exitCode = render(
			name,
			options.json ? withLink(output, options, showLink) : output,
			options,
		);
		if (showLink && options.link && !options.json && !output.isError) {
			out(pairs(linkRows(options.link), options.style));
		}
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
			reason: z.string().optional(),
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

function refusalText(entry: ChangeEntry, repo: string): string {
	const reasons =
		blockingReasons(entry) ||
		`Run tripwire workflows validate --repo ${repo} to see why.`;
	return entry.reason === "live-cannot-run"
		? `${entry.id} is on, so this version was not saved. ${reasons}`
		: `${entry.id} was not saved. ${reasons}`;
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

interface PullOptions extends WorkflowFileOptions {
	force?: boolean;
	all?: boolean;
	yes?: boolean;
	link: boolean;
}

interface SavedLink {
	path: string;
	linked: boolean;
}

function savePullLink(file: string, link: ProjectLink): SavedLink {
	const dir = dirname(resolve(file));
	const here = findProjectLink(dir, dir);
	const linked =
		!here || here.link.repo !== link.repo || here.link.org !== link.org;
	if (here && sameLink(here.link, link)) {
		return { path: here.path, linked };
	}
	return { path: writeProjectLink(dir, link), linked };
}

interface ProjectKeys {
	found: FoundLink | null;
	mapping: Record<string, string>;
}

function projectKeys(file: string, repo: string): ProjectKeys {
	const found = findProjectLink(dirname(resolve(file)));
	return {
		found,
		mapping:
			found && found.link.repo === repo ? (found.link.workflows ?? {}) : {},
	};
}

function idKeys(matched: MatchedWorkflows): Map<string, string> {
	return new Map(matched.matches.map((match) => [match.id, match.key]));
}

async function serverWorkflows(
	deps: ManageDeps,
	options: GlobalOptions,
	repo: string,
): Promise<NamedWorkflow[]> {
	const output = await callForData(deps, options, "get_workflow", { repo });
	return output.isError
		? []
		: pulledWorkflows(output.data).map((workflow) => workflow.definition);
}

async function withServerIds(
	deps: ManageDeps,
	options: GlobalOptions,
	repo: string,
	file: string,
	definitions: WorkflowDefinition[],
): Promise<MatchedWorkflows> {
	const { mapping } = projectKeys(file, repo);
	const unmapped = definitions.some((definition) => !mapping[definition.id]);
	const server = unmapped ? await serverWorkflows(deps, options, repo) : [];
	const matched = matchWorkflowIds(definitions, server, mapping);
	for (const match of matched.matches) {
		if (match.by === "new" && unmapped) {
			err(
				warnLine(
					`${match.key} matches no workflow on the server, so a push adds it as a new one.`,
					options.errStyle,
				),
			);
		}
		if (match.by === "name") {
			const name = server.find((workflow) => workflow.id === match.id)?.name;
			err(
				warnLine(
					`${match.key} has no saved id in .tripwire/project.json, so it matches ${name ?? match.id} on the server by its name.`,
					options.errStyle,
				),
			);
		}
	}
	return matched;
}

function rememberIds(file: string, repo: string, matched: MatchedWorkflows) {
	const { found } = projectKeys(file, repo);
	if (!found || found.link.repo !== repo) {
		return;
	}
	const ids = new Set(matched.matches.map((match) => match.id));
	const kept = Object.entries(found.link.workflows ?? {}).filter(
		([, id]) => !ids.has(id),
	);
	const workflows = workflowMapping(
		new Map([
			...kept.map(([key, id]): [string, string] => [id, key]),
			...idKeys(matched),
		]),
	);
	const next = { ...found.link, workflows };
	if (!sameLink(found.link, next)) {
		writeProjectLink(dirname(dirname(found.path)), next);
	}
}

const keyedSchema = z.looseObject({
	workflows: z.array(z.looseObject({ id: z.string() })),
});

function keyed(
	data: JsonValue | null,
	keys: ReadonlyMap<string, string>,
): JsonValue | null {
	const parsed = keyedSchema.safeParse(data);
	if (!parsed.success) {
		return data;
	}
	return z.json().parse({
		...parsed.data,
		workflows: parsed.data.workflows.map((entry) => ({
			...entry,
			id: keys.get(entry.id) ?? entry.id,
		})),
	});
}

const WORKFLOW_STATES = [
	"on",
	"off",
	"cant-run",
	"needs-fixes",
	"cant-turn-on",
] as const satisfies readonly WorkflowState[];

const listedWorkflowsSchema = z.array(
	z.looseObject({
		id: z.string(),
		state: z.enum(WORKFLOW_STATES).optional(),
		schedules: z.array(z.string()).optional(),
	}),
);

async function listedWorkflows(
	deps: ManageDeps,
	options: GlobalOptions,
	repo: string,
): Promise<Map<string, ListedWorkflow>> {
	const output = await callForData(deps, options, "list_workflows", { repo });
	const parsed = listedWorkflowsSchema.safeParse(output.data);
	return new Map(
		(parsed.success ? parsed.data : []).map((entry) => [
			entry.id,
			{ state: entry.state, schedules: entry.schedules },
		]),
	);
}

function localIds(local: LocalWorkflows): string[] | null {
	return local.kind === "code"
		? local.definitions.map((definition) => definition.id)
		: null;
}

async function pickWorkflows(
	deps: ManageDeps,
	options: GlobalOptions,
	repo: string,
	workflows: PulledWorkflow[],
	local: LocalWorkflows,
): Promise<PulledWorkflow[] | null> {
	const choices = workflowChoices(
		workflows,
		await listedWorkflows(deps, options, repo),
	);
	if (choices.filter((choice) => !choice.disabled).length < 2) {
		return workflows;
	}
	const ids = await runPicker(
		{ message: "Pick workflows to pull", items: choices, maxVisible: 12 },
		initialPicks(choices, localIds(local)),
		{
			input: process.stdin,
			write: (text) => process.stdout.write(text),
			columns: () => process.stdout.columns || 80,
		},
	);
	return ids ? workflows.filter((workflow) => ids.includes(workflow.id)) : null;
}

function keptText(kept: readonly string[]): string {
	const names =
		kept.length === 1
			? (kept[0] ?? "")
			: `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}`;
	return kept.length === 1
		? `${names}, not pulled and left as it was`
		: `${names}, not pulled and left as they were`;
}

function pullWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	wanted: string[],
	opts: PullOptions,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const output = await callForData(deps, options, "get_workflow", { repo });
		if (output.isError) {
			return render("get_workflow", output, options);
		}
		const workflows = pulledWorkflows(output.data);
		const read = await readLocalWorkflows(opts.file);
		const { mapping } = projectKeys(opts.file, repo);
		const matched =
			read.kind === "code"
				? matchWorkflowIds(
						read.definitions,
						workflows.map((workflow) => workflow.definition),
						mapping,
					)
				: null;
		const local: LocalWorkflows =
			read.kind === "code" && matched
				? { ...read, definitions: matched.definitions }
				: read;
		const savedKeys = new Map([
			...Object.entries(mapping).map(([key, id]): [string, string] => [
				id,
				key,
			]),
			...(matched ? idKeys(matched) : []),
		]);
		const localKeys = new Map([
			...savedKeys,
			...workflowKeys(
				workflows.map((workflow) => workflow.definition),
				savedKeys,
			),
		]);
		let picked = workflows;
		if (wanted.length > 0) {
			const selection = selectPulled(workflows, wanted, localKeys);
			if (selection.unknown.length > 0) {
				throw new Error(
					`No workflow ${selection.unknown.join(", ")} on ${repo}. Run tripwire workflows list <repo> to see them.`,
				);
			}
			picked = selection.picked;
		} else if (
			process.stdin.isTTY &&
			process.stdout.isTTY &&
			!(options.json || opts.all || opts.yes)
		) {
			const chosen = await pickWorkflows(deps, options, repo, workflows, local);
			if (!chosen) {
				p.cancel("Pull cancelled");
				return 0;
			}
			picked = chosen;
		}
		const written = writePulled(
			opts.file,
			picked.map((workflow) => workflow.definition),
			opts.force === true,
			local,
			localKeys,
		);
		const linked = opts.link
			? savePullLink(opts.file, {
					org: options.org,
					repo,
					workflows: workflowMapping(written.keys),
				})
			: null;
		if (options.json) {
			out(
				JSON.stringify(
					{
						...written,
						keys: Object.fromEntries(written.keys),
						link: linked?.path ?? null,
					},
					null,
					2,
				),
			);
			return 0;
		}
		const rows: [string, string][] = [
			["wrote", `${written.file} (${pulledCountText(written)})`],
		];
		if (written.kept.length > 0) {
			rows.push(["kept", keptText(written.kept)]);
		}
		rows.push(["helpers", written.module]);
		if (linked?.linked) {
			rows.push(["linked", `${repo} in ${linked.path}`]);
		}
		rows.push(
			...written.warnings.map((warning): [string, string] => ["note", warning]),
		);
		out(pairs(rows, options.style));
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
		let { definitions } = compiled;
		let reports: ReportView[] = [];
		let remote: JsonValue | null = null;
		if (definitions.length > 0 && opts.repo) {
			const matched = await withServerIds(
				deps,
				options,
				opts.repo,
				opts.file,
				definitions,
			);
			const output = await callForData(deps, options, "validate_workflow", {
				repo: opts.repo,
				definitions: definitionsJson(matched.definitions),
			});
			if (output.isError) {
				if (issues.length > 0) {
					err(compileIssueLines(issues, options));
				}
				return render("validate_workflow", output, options);
			}
			remote = output.data;
			reports = reportsSchema.parse(
				keyed(output.data, idKeys(matched)),
			).workflows;
		} else if (definitions.length > 0) {
			reports = reportWorkflows(definitions, localCatalog(definitions));
			const linked = options.link?.link;
			definitions = matchWorkflowIds(
				definitions,
				[],
				linked ? (linked.workflows ?? {}) : {},
			).definitions;
		}
		const valid =
			issues.length === 0 && reports.every((report) => report.valid);
		if (options.json) {
			out(
				JSON.stringify(
					remote !== null && issues.length === 0
						? remote
						: {
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
		const compiled = await compileFile(opts.file, options);
		if (!compiled) {
			return 1;
		}
		const matched = await withServerIds(
			deps,
			options,
			repo,
			opts.file,
			compiled,
		);
		const raw = await callForData(deps, options, "validate_workflow", {
			repo,
			definitions: definitionsJson(matched.definitions),
		});
		if (options.json || raw.isError) {
			return render("validate_workflow", raw, options);
		}
		const output = { ...raw, data: keyed(raw.data, idKeys(matched)) };
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

interface PushOptions extends WorkflowFileOptions {
	force?: boolean;
	browser: boolean;
	wait?: boolean;
}

async function applyDirect(
	deps: ManageDeps,
	options: GlobalOptions,
	repo: string,
	file: string,
	matched: MatchedWorkflows,
): Promise<number> {
	const raw = await callForData(deps, options, "apply_workflow", {
		repo,
		definitions: definitionsJson(matched.definitions),
	});
	if (raw.isError) {
		return render("apply_workflow", raw, options);
	}
	rememberIds(file, repo, matched);
	const output = options.json
		? raw
		: { ...raw, data: keyed(raw.data, idKeys(matched)) };
	const parsed = changeListSchema.safeParse(output.data);
	const refused = parsed.success
		? parsed.data.workflows.filter((entry) => entry.outcome === "refused")
		: [];
	if (options.json) {
		out(JSON.stringify(output.data ?? { text: output.text }, null, 2));
		return refused.length > 0 ? 1 : 0;
	}
	out(
		changeLines(output.data, options.style, (entry) =>
			[entry.id, entry.outcome, entry.url].filter(Boolean).join("  "),
		),
	);
	for (const entry of refused) {
		err(errorLine(refusalText(entry, repo), options.errStyle));
	}
	return refused.length > 0 ? 1 : 0;
}

async function readPush(
	deps: ManageDeps,
	options: GlobalOptions,
	push: WorkflowPushView,
	waitSeconds: number,
): Promise<WorkflowPushView> {
	const output = await callForData(
		deps,
		{ ...options, org: push.org },
		"get_workflow_push",
		{ push: push.id, waitSeconds },
	);
	if (output.isError) {
		throw new Error(friendlyError(output.text, output.data));
	}
	return workflowPushViewSchema.parse(output.data);
}

async function awaitReview(
	deps: ManageDeps,
	options: GlobalOptions,
	push: WorkflowPushView,
): Promise<WorkflowPushView> {
	const spin =
		process.stderr.isTTY && !options.json
			? p.spinner({ output: process.stderr })
			: null;
	spin?.start(waitingText(push));
	if (!spin && !options.json) {
		err(pairs([["", waitingText(push)]], options.errStyle));
	}
	try {
		const final = await waitForDecision(push, {
			read: (waitSeconds) => readPush(deps, options, push, waitSeconds),
			sleep: deps.auth.sleep,
		});
		spin?.stop(WORKFLOW_PUSH_STATUS_LABELS[final.status]);
		return final;
	} catch (error) {
		spin?.error("Lost track of the review");
		throw error;
	}
}

function pushWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	opts: PushOptions,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const compiled = await compileFile(opts.file, options);
		if (!compiled) {
			return 1;
		}
		const matched = await withServerIds(
			deps,
			options,
			repo,
			opts.file,
			compiled,
		);
		if (opts.force) {
			return await applyDirect(deps, options, repo, opts.file, matched);
		}
		const output = await callForData(deps, options, "propose_workflow_push", {
			repo,
			definitions: definitionsJson(matched.definitions),
		});
		if (output.isError) {
			return render("propose_workflow_push", output, options);
		}
		const proposal = workflowPushProposalResultSchema.parse(output.data);
		if (proposal.result === "unchanged") {
			rememberIds(opts.file, repo, matched);
			if (options.json) {
				out(JSON.stringify(proposal, null, 2));
			} else {
				out(pairs([["done", "No changes to push"]], options.style));
			}
			return 0;
		}
		if (proposal.result === "blocked") {
			if (options.json) {
				out(JSON.stringify(proposal, null, 2));
			} else {
				err(blockedText(proposal.workflows, options.errStyle));
			}
			return 1;
		}
		const { push } = proposal;
		if (options.json && !opts.wait) {
			out(JSON.stringify(push, null, 2));
			return 0;
		}
		if (!options.json) {
			err(pairs([["review", push.url]], options.errStyle));
		}
		if (
			opts.browser &&
			deps.openUrl &&
			canOpenBrowser(deps.system.env, deps.system.platform)
		) {
			await deps.openUrl(push.url).catch(() => undefined);
		}
		const final = await awaitReview(deps, options, push);
		if (final.status === "accepted") {
			rememberIds(opts.file, repo, matched);
		}
		if (options.json) {
			out(JSON.stringify(final, null, 2));
		} else if (final.status === "accepted") {
			out(outcomeText(final, options.style));
		} else {
			err(errorLine(pushRefusalText(final, repo), options.errStyle));
		}
		return pushExitCode(final.status);
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

async function linkProject(
	deps: ManageDeps,
	command: Command,
	repo: string,
): Promise<void> {
	const options = globals(command, deps.system);
	try {
		const output = await callForData(deps, options, "list_workflows", {
			repo,
		});
		if (output.isError) {
			process.exitCode = render("list_workflows", output, options);
			return;
		}
		const here = findProjectLink(process.cwd(), process.cwd());
		const link: ProjectLink = {
			org: options.org,
			repo,
			workflows: here?.link.repo === repo ? here.link.workflows : undefined,
		};
		const path = writeProjectLink(process.cwd(), link);
		const found = { path, link: { ...link } };
		if (options.json) {
			out(JSON.stringify({ ...found.link, path }, null, 2));
			return;
		}
		out(pairs(linkRows(found), options.style));
	} catch (error) {
		process.exitCode = fail(
			error instanceof Error ? error : new Error(String(error)),
			options,
		);
	}
}

function unlinkProject(deps: ManageDeps, command: Command): void {
	const options = globals(command, deps.system);
	const path =
		options.link?.path ??
		(options.linkError instanceof InvalidProjectLinkError
			? options.linkError.path
			: null);
	if (path) {
		removeProjectLink(path);
	}
	if (options.json) {
		out(JSON.stringify({ unlinked: path }, null, 2));
		return;
	}
	out(
		pairs(
			[["done", path ? `Unlinked, removed ${path}` : "Not linked"]],
			options.style,
		),
	);
}

interface CustomRuleOptions {
	name?: string;
	description?: string;
	definition?: string;
	enable?: boolean;
	disable?: boolean;
	outcome?: string;
	instruction?: string;
}

interface OutcomeOptions {
	outcome?: string;
	instruction?: string;
}

const OUTCOME_HELP = `When this does not pass, --outcome picks what happens:
  block         red check and a changes-requested review (the default)
  request_fix   red check and the --instruction text, no review
  human_review  pending check until a maintainer decides
  note          green check with the --instruction text as a note
  close         closes the change request
A rule a workflow owns takes its outcome from the workflow.
`;

function outcomeArgs(opts: OutcomeOptions): ToolArgs {
	const args: ToolArgs = {};
	if (opts.outcome !== undefined) {
		const parsed = ruleOutcomeSchema.safeParse(opts.outcome);
		if (!parsed.success) {
			throw new Error(
				`--outcome must be one of ${ruleOutcomeSchema.options.join(", ")}.`,
			);
		}
		args.outcome = parsed.data;
	}
	if (opts.instruction !== undefined) {
		args.instruction = opts.instruction;
	}
	return args;
}

function outcomeFlags(command: Command): Command {
	return command
		.option(
			"--outcome <outcome>",
			"When this does not pass: block, request_fix, human_review, note or close",
		)
		.option(
			"--instruction <text>",
			"What the author must change, or the note to post",
		);
}

const CUSTOM_RULE_HELP = `
A definition is JSON: {"when":{"id":"<signal>"},"comparison":{"kind":"<verb>","args":[...]}}.
The rule passes when the comparison holds. Run tripwire rules list <repo> to see rules and their sentences.

Example:
  tripwire rules create acme/web --name "Not into release" \\
    --definition '{"when":{"id":"pr.targetBranch"},"comparison":{"kind":"noneOf","args":[["release"]]}}'
`;

function readDefinition(raw: string): JsonValue {
	let text = raw;
	if (raw.startsWith("@")) {
		try {
			text = readFileSync(raw.slice(1), "utf8");
		} catch {
			throw new Error(`Cannot read ${raw.slice(1)}.`);
		}
	}
	try {
		return z.json().parse(JSON.parse(text));
	} catch {
		throw new Error(
			"--definition must be JSON, or @ and the path to a JSON file.",
		);
	}
}

function customRuleArgs(opts: CustomRuleOptions): ToolArgs {
	if (opts.enable && opts.disable) {
		throw new Error("Pass --enable or --disable, not both.");
	}
	const args: ToolArgs = {};
	if (opts.name !== undefined) {
		args.name = opts.name;
	}
	if (opts.description !== undefined) {
		args.description = opts.description;
	}
	if (opts.definition !== undefined) {
		args.definition = readDefinition(opts.definition);
	}
	if (opts.enable || opts.disable) {
		args.enabled = opts.enable === true;
	}
	return { ...args, ...outcomeArgs(opts) };
}

const currentRulesSchema = z.array(
	z.looseObject({
		ruleId: z.string(),
		name: z.string(),
		definition: z.json().optional(),
	}),
);

function saveCustomRule(
	deps: ManageDeps,
	command: Command,
	repo: string,
	ruleId: string | undefined,
	args: ToolArgs,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		let body = args;
		if (
			ruleId !== undefined &&
			(args.name === undefined || args.definition === undefined)
		) {
			const output = await callForData(deps, options, "get_repo_rules", {
				repo,
			});
			if (output.isError) {
				return render("get_repo_rules", output, options);
			}
			const parsed = currentRulesSchema.safeParse(output.data);
			const current = parsed.success
				? parsed.data.find((rule) => rule.ruleId === ruleId)
				: undefined;
			if (current?.definition === undefined) {
				throw new Error(
					`No custom rule ${ruleId} on ${repo}. Run tripwire rules list ${repo} to see them.`,
				);
			}
			body = { name: current.name, definition: current.definition, ...args };
		}
		const request: ToolArgs = { repo, ...body };
		if (ruleId !== undefined) {
			request.id = ruleId;
		}
		const output = await callForData(
			deps,
			options,
			"save_custom_rule",
			request,
		);
		return render("save_custom_rule", output, options);
	});
}

function customRuleFlags(command: Command): Command {
	return outcomeFlags(command)
		.option("--name <name>", "The rule's name")
		.option(
			"--definition <json>",
			"The rule as JSON, or @ and the path to a JSON file",
		)
		.option("--description <text>", "Why the rule exists")
		.option("--enable", "Run the rule by itself")
		.option("--disable", "Stop running the rule by itself")
		.addHelpText("after", `${CUSTOM_RULE_HELP}\n${OUTCOME_HELP}`);
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
			runTool(deps, command, "whoami", {}, true),
		);

	program
		.command("status")
		.description("Show setup status and the next step")
		.action((_options, command: Command) =>
			runTool(deps, command, "setup_status", {}, true),
		);

	program
		.command("link <repo>")
		.description(
			"Save the repo (and --org) to .tripwire/project.json here, so later commands can leave them out",
		)
		.action((repo: string, _options, command: Command) =>
			linkProject(deps, command, repo),
		);

	program
		.command("unlink")
		.description("Remove the nearest .tripwire/project.json")
		.action((_options, command: Command) => unlinkProject(deps, command));

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
			"List a repo's rules (default: the linked repo), or the rule catalog when there is no repo",
		)
		.option("--catalog", "List the rule catalog")
		.action(
			(
				repo: string | undefined,
				opts: { catalog?: boolean },
				command: Command,
			) => {
				const linked = globals(command, deps.system).link;
				return repo || (linked && !opts.catalog)
					? withRepo(deps, command, repo, (target) =>
							runTool(deps, command, "get_repo_rules", { repo: target }),
						)
					: runTool(deps, command, "list_rule_catalog", {});
			},
		);
	outcomeFlags(
		rules
			.command("set <repoOrRule> [ruleId]")
			.usage("[options] [repo] <ruleId>")
			.description(
				"Turn a rule on or off, set its params, and set what happens when it does not pass. A custom rule has no params",
			)
			.option("--enable", "Turn the rule on")
			.option("--disable", "Turn the rule off")
			.option(
				"--param <key=value>",
				"Set a param, repeatable. Values parse as JSON when they can",
				(value: string, previous: string[]) => [...previous, value],
				[],
			),
	)
		.addHelpText("after", `\n${OUTCOME_HELP}`)
		.action(
			(
				first: string,
				second: string | undefined,
				opts: {
					enable?: boolean;
					disable?: boolean;
					param: string[];
				} & OutcomeOptions,
				command: Command,
			) => {
				const [repo, ruleId] =
					second === undefined ? [undefined, first] : [first, second];
				const args: ToolArgs = { ruleId };
				if (opts.enable || opts.disable) {
					args.enabled = opts.enable === true;
				}
				try {
					if (opts.param.length > 0) {
						args.config = Object.fromEntries(opts.param.map(parseParam));
					}
					Object.assign(args, outcomeArgs(opts));
					if (
						args.enabled === undefined &&
						args.config === undefined &&
						args.outcome === undefined &&
						args.instruction === undefined
					) {
						throw new Error(
							"Pass --enable, --disable, --param, --outcome or --instruction.",
						);
					}
				} catch (error) {
					process.exitCode = fail(
						error instanceof Error ? error : new Error(String(error)),
						globals(command, deps.system),
					);
					return;
				}
				return withRepo(deps, command, repo, (target) =>
					runTool(deps, command, "set_rule", { repo: target, ...args }),
				);
			},
		);

	customRuleFlags(
		rules
			.command("create [repo]")
			.description(
				"Create a custom rule. It starts off: pass --enable, or use it in tripwire.ts with customCheck",
			),
	).action(
		(repo: string | undefined, opts: CustomRuleOptions, command: Command) => {
			let args: ToolArgs;
			try {
				args = customRuleArgs(opts);
				if (args.name === undefined || args.definition === undefined) {
					throw new Error("Pass --name and --definition.");
				}
			} catch (error) {
				process.exitCode = fail(
					error instanceof Error ? error : new Error(String(error)),
					globals(command, deps.system),
				);
				return;
			}
			return withRepo(deps, command, repo, (target) =>
				saveCustomRule(deps, command, target, undefined, args),
			);
		},
	);
	customRuleFlags(
		rules
			.command("update <repoOrRule> [ruleId]")
			.usage("[options] [repo] <ruleId>")
			.description(
				"Change a custom rule in place. Options you leave out keep their value",
			),
	).action(
		(
			first: string,
			second: string | undefined,
			opts: CustomRuleOptions,
			command: Command,
		) => {
			const [repo, ruleId] =
				second === undefined ? [undefined, first] : [first, second];
			let args: ToolArgs;
			try {
				args = customRuleArgs(opts);
				if (Object.keys(args).length === 0) {
					throw new Error(
						"Pass --name, --definition, --description, --enable, --disable, --outcome or --instruction.",
					);
				}
			} catch (error) {
				process.exitCode = fail(
					error instanceof Error ? error : new Error(String(error)),
					globals(command, deps.system),
				);
				return;
			}
			return withRepo(deps, command, repo, (target) =>
				saveCustomRule(deps, command, target, ruleId, args),
			);
		},
	);
	rules
		.command("delete <repoOrRule> [ruleId]")
		.usage("[options] [repo] <ruleId>")
		.description(
			"Delete a custom rule. A rule a workflow uses cannot be deleted",
		)
		.action(
			(
				first: string,
				second: string | undefined,
				_options,
				command: Command,
			) => {
				const [repo, ruleId] =
					second === undefined ? [undefined, first] : [first, second];
				return withRepo(deps, command, repo, (target) =>
					runTool(deps, command, "delete_custom_rule", {
						repo: target,
						id: ruleId,
					}),
				);
			},
		);

	program
		.command("gate")
		.description("Control the Tripwire gate on a repo")
		.command("on [repo]")
		.description("Turn the gate on for a repo")
		.action((repo: string | undefined, _options, command: Command) =>
			withRepo(deps, command, repo, (target) =>
				runTool(deps, command, "turn_on_gate", { repo: target }),
			),
		);

	const workflows = program
		.command("workflows")
		.description(
			"Manage workflows as tripwire.ts code: pull, validate, diff and push",
		);
	workflows
		.command("pull [repo] [workflows...]")
		.description(
			"Write a repo's workflows to tripwire.ts, with the typed helpers and the repo link in .tripwire/",
		)
		.option("--file <path>", "Where to write the code", DEFAULT_WORKFLOW_FILE)
		.option("--all", "Pull every workflow without asking")
		.option("-y, --yes", "Skip the picker")
		.option("--force", "Overwrite workflows that differ from the server")
		.option("--no-link", "Do not save the repo to .tripwire/project.json")
		.action(
			(
				repo: string | undefined,
				wanted: string[],
				opts: PullOptions,
				command: Command,
			) =>
				withRepo(deps, command, repo, (target) =>
					pullWorkflows(deps, command, target, wanted, {
						...opts,
						file: linkedFile(deps, command, opts.file),
					}),
				),
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
			validateWorkflows(deps, command, {
				...opts,
				file: linkedFile(deps, command, opts.file),
			}),
		);
	workflows
		.command("diff [repo]")
		.description("Show what a push of tripwire.ts would change on the repo")
		.option("--file <path>", "The workflow file", DEFAULT_WORKFLOW_FILE)
		.action(
			(repo: string | undefined, opts: WorkflowFileOptions, command: Command) =>
				withRepo(deps, command, repo, (target) =>
					diffWorkflows(deps, command, target, {
						...opts,
						file: linkedFile(deps, command, opts.file),
					}),
				),
		);
	workflows
		.command("push [repo]")
		.description(
			"Send tripwire.ts for review in the browser, then save it once accepted. New workflows start off",
		)
		.option("--file <path>", "The workflow file", DEFAULT_WORKFLOW_FILE)
		.option("--force", "Save without review")
		.option("--no-browser", "Print the review link without opening a browser")
		.option("--wait", "With --json, wait for the review")
		.action((repo: string | undefined, opts: PushOptions, command: Command) =>
			withRepo(deps, command, repo, (target) =>
				pushWorkflows(deps, command, target, {
					...opts,
					file: linkedFile(deps, command, opts.file),
				}),
			),
		);
	workflows
		.command("list [repo]")
		.description("List a repo's workflows")
		.action((repo: string | undefined, _options, command: Command) =>
			withRepo(deps, command, repo, (target) =>
				runTool(deps, command, "list_workflows", { repo: target }),
			),
		);
	for (const verb of ["enable", "disable"] as const) {
		workflows
			.command(`${verb} <repoOrWorkflow> [workflowId]`)
			.usage("[options] [repo] <workflowId>")
			.description(`${verb === "enable" ? "Enable" : "Disable"} a workflow`)
			.action(
				(
					first: string,
					second: string | undefined,
					_options,
					command: Command,
				) => {
					const [repo, workflowId] =
						second === undefined ? [undefined, first] : [first, second];
					return withRepo(deps, command, repo, (target) =>
						runTool(deps, command, "set_workflow_enabled", {
							repo: target,
							workflowId,
							enabled: verb === "enable",
						}),
					);
				},
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
		.command("decide <first> <second> [third]")
		.usage("[options] [repo] <itemId> <action>")
		.description(
			"Decide an item: approve, remove or ban. A ban returns a link a human must open",
		)
		.action(
			(
				first: string,
				second: string,
				third: string | undefined,
				_options,
				command: Command,
			) => {
				const [repo, itemId, action] =
					third === undefined
						? [undefined, first, second]
						: [first, second, third];
				if (!["approve", "remove", "ban"].includes(action)) {
					process.exitCode = fail(
						new Error(decisionChoiceError(action)),
						globals(command, deps.system),
					);
					return;
				}
				return withRepo(deps, command, repo, (target) =>
					runTool(deps, command, "decide_moderation", {
						repo: target,
						itemId,
						decision: action,
					}),
				);
			},
		);
}
