import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
	type CompileIssue,
	compileIssueText,
	type MatchedWorkflows,
	matchWorkflowIds,
	type NamedWorkflow,
	reportWorkflows,
	WORKFLOW_PUSH_STATUS_LABELS,
	type WorkflowDefinition,
	type WorkflowPushView,
	workflowDefinitionSchema,
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
import {
	type FoundLink,
	findProjectLink,
	InvalidProjectLinkError,
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
	reviewLink,
	waitForDecision,
	waitingText,
} from "#/push-review";
import type { System } from "#/system";
import {
	DEFAULT_WORKFLOW_DIRECTORY,
	discoverWorkflowFiles,
	formatReports,
	type LocalWorkflows,
	loadWorkflowFileWithFormat,
	localCatalog,
	pulledCountText,
	pulledWorkflows,
	type ReportView,
	readLocalWorkflows,
	selectPulled,
	selectWorkflowSources,
	typecheckSdkWorkflow,
	writePulled,
	writeSdkWorkflows,
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
		if (output.isError) {
			err(
				JSON.stringify({
					error: {
						code: "OPERATION_FAILED",
						message: friendlyError(output.text, output.data),
					},
				}),
			);
			return 1;
		}
		out(JSON.stringify(output.data ?? { text: output.text }));
		return 0;
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
		err(
			JSON.stringify({
				error: {
					code: "OPERATION_FAILED",
					message: friendlyError(error.message),
				},
			}),
		);
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
		if (!options.json) {
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
		}
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
	retainSource = false,
): Promise<{
	definitions: WorkflowDefinition[];
	format: "legacy" | "sdk";
} | null> {
	const loaded = await loadWorkflowFileWithFormat(file);
	if (loaded.result.ok) {
		const source = retainSource ? loaded.source : undefined;
		const definitions =
			source === undefined
				? loaded.result.definitions
				: loaded.result.definitions.map((definition) =>
						workflowDefinitionSchema.parse({
							...definition,
							authoredSource: source,
						}),
					);
		return { definitions, format: loaded.format };
	}
	if (options.json) {
		err(
			JSON.stringify({
				error: {
					code: "INVALID_WORKFLOW",
					message: "The workflow file did not compile.",
					details: { issues: loaded.result.issues },
				},
			}),
		);
	} else {
		err(compileIssueLines(loaded.result.issues, options));
	}
	return null;
}

interface CompiledWorkflowSources {
	definitions: WorkflowDefinition[];
	files: string[];
	format: "legacy" | "sdk";
	context: string;
}

function defaultWorkflowDirectory(options: GlobalOptions): string {
	const root = options.link
		? dirname(dirname(options.link.path))
		: process.cwd();
	return join(root, DEFAULT_WORKFLOW_DIRECTORY);
}

async function compileWorkflowSources(
	wanted: readonly string[],
	file: string | undefined,
	options: GlobalOptions,
	retainSource = false,
): Promise<CompiledWorkflowSources | null> {
	if (file !== undefined) {
		const compiled = await compileFile(file, options, retainSource);
		if (!compiled) {
			return null;
		}
		const definitions =
			wanted.length === 0
				? compiled.definitions
				: compiled.definitions.filter((definition) =>
						wanted.includes(definition.id),
					);
		const unknown = wanted.filter(
			(slug) =>
				!compiled.definitions.some((definition) => definition.id === slug),
		);
		if (unknown.length > 0) {
			throw new Error(
				`No workflow ${unknown.join(", ")} in ${file}. Available workflows: ${compiled.definitions.map(({ id }) => id).join(", ") || "none"}.`,
			);
		}
		return {
			definitions,
			files: [file],
			format: compiled.format,
			context: file,
		};
	}
	const directory = defaultWorkflowDirectory(options);
	const sources = selectWorkflowSources(
		discoverWorkflowFiles(directory),
		wanted,
	);
	if (sources.length === 0) {
		throw new Error(
			`No local workflow files in ${directory}. Pull a workflow or add a .ts file first. Removing a local file does not delete the workflow in Tripwire.`,
		);
	}
	const definitions: WorkflowDefinition[] = [];
	for (const source of sources) {
		const loaded = await compileFile(source.file, options, retainSource);
		if (!loaded) return null;
		if (loaded.format !== "sdk" || loaded.definitions.length !== 1) {
			throw new Error(
				`${source.file} must default-export exactly one @tripwire-sh/sdk workflow. Use --file for legacy tripwire.ts collections.`,
			);
		}
		const [definition] = loaded.definitions;
		if (!definition || definition.id !== source.slug) {
			throw new Error(
				`${source.file} compiled as ${definition?.id ?? "nothing"}; its workflow id must match the filename slug ${source.slug}.`,
			);
		}
		definitions.push(definition);
	}
	return {
		definitions,
		files: sources.map(({ file: source }) => source),
		format: "sdk",
		context: directory,
	};
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

interface PullOptions {
	file?: string;
	force?: boolean;
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

function keptText(kept: readonly string[]): string {
	const names =
		kept.length === 1
			? (kept[0] ?? "")
			: `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}`;
	return kept.length === 1
		? `${names}, not pulled and left as it was`
		: `${names}, not pulled and left as they were`;
}

function pullSdkWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	wanted: string[],
	opts: PullOptions,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		if (options.link && options.link.link.repo !== repo) {
			throw new Error(
				`This project is linked to ${options.link.link.repo}, not ${repo}. Run tripwire unlink, then tripwire link ${repo} before pulling another repository here.`,
			);
		}
		const output = await callForData(deps, options, "get_workflow", { repo });
		if (output.isError) {
			return render("get_workflow", output, options);
		}
		const workflows = pulledWorkflows(output.data);
		const mapping =
			options.link?.link.repo === repo
				? (options.link.link.workflows ?? {})
				: {};
		const savedKeys = new Map(
			Object.entries(mapping).map(([key, id]): [string, string] => [id, key]),
		);
		const directory = defaultWorkflowDirectory(options);
		const localSlugs = new Set(
			discoverWorkflowFiles(directory).map(({ slug }) => slug),
		);
		const remoteIds = new Set(workflows.map(({ id }) => id));
		const stale = Object.entries(mapping)
			.filter(([key, id]) => localSlugs.has(key) && !remoteIds.has(id))
			.map(([key, id]) => ({ id, name: key }));
		const allKeys = workflowKeys(
			[...workflows.map(({ definition }) => definition), ...stale],
			savedKeys,
		);
		const keys = new Map(
			workflows.map(({ id }) => [id, allKeys.get(id) ?? id]),
		);
		const requested = new Set(wanted);
		const available = new Set(keys.values());
		const unknown = [...requested].filter((slug) => !available.has(slug));
		if (unknown.length > 0) {
			throw new Error(
				`No workflow ${unknown.join(", ")} on ${repo}. Available workflows: ${[...available].join(", ") || "none"}.`,
			);
		}
		const picked = workflows.filter(
			({ id }) => requested.size === 0 || requested.has(keys.get(id) ?? ""),
		);
		const written = writeSdkWorkflows(
			directory,
			picked.map(({ definition }) => definition),
			keys,
			opts.force === true,
			options.link?.link.workflowPullHashes,
		);
		let link: string | null = null;
		if (opts.link) {
			const root = options.link
				? dirname(dirname(options.link.path))
				: process.cwd();
			const next: ProjectLink = {
				org: options.org,
				repo,
				workflows: {
					...Object.fromEntries(
						stale.map(({ id }) => [allKeys.get(id) ?? id, id]),
					),
					...workflowMapping(keys),
				},
			};
			next.workflowPullHashes = {
				...Object.fromEntries(
					Object.entries(options.link?.link.workflowPullHashes ?? {}).filter(
						([slug]) => next.workflows?.[slug] === mapping[slug],
					),
				),
				...written.hashes,
			};
			link =
				options.link && sameLink(options.link.link, next)
					? options.link.path
					: writeProjectLink(root, next);
		}
		if (options.json) {
			out(
				JSON.stringify({
					directory,
					files: written.files,
					unchanged: written.unchanged,
					link,
					keys: Object.fromEntries(keys),
				}),
			);
			return 0;
		}
		out(
			pairs(
				[
					[
						"wrote",
						`${written.files.length} workflow file${written.files.length === 1 ? "" : "s"}`,
					],
					["kept", `${written.unchanged.length} unchanged`],
					...(link
						? ([["linked", `${repo} in ${link}`]] as [string, string][])
						: []),
				],
				options.style,
			),
		);
		return 0;
	});
}

function pullWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	wanted: string[],
	opts: PullOptions,
): Promise<void> {
	if (opts.file === undefined) {
		return pullSdkWorkflows(deps, command, repo, wanted, opts);
	}
	const file = opts.file;
	return workflowAction(command, deps, async (options) => {
		const output = await callForData(deps, options, "get_workflow", { repo });
		if (output.isError) {
			return render("get_workflow", output, options);
		}
		const workflows = pulledWorkflows(output.data);
		const read = await readLocalWorkflows(file);
		const { mapping } = projectKeys(file, repo);
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
		}
		const written = writePulled(
			file,
			picked.map((workflow) => workflow.definition),
			opts.force === true,
			local,
			localKeys,
		);
		const linked = opts.link
			? savePullLink(file, {
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
	wanted: string[],
	opts: { file?: string; repo?: string },
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const compiled = await compileWorkflowSources(wanted, opts.file, options);
		if (!compiled) return 1;
		const issues: CompileIssue[] = [];
		let { definitions } = compiled;
		let reports: ReportView[] = [];
		let remote: JsonValue | null = null;
		if (definitions.length > 0 && opts.repo) {
			const matched = await withServerIds(
				deps,
				options,
				opts.repo,
				compiled.context,
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
			return 0;
		}
		if (issues.length > 0) {
			err(compileIssueLines(issues, options));
		}
		if (reports.length > 0) {
			out(formatReports(reports, options.style));
		}
		return 0;
	});
}

function diffWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	wanted: string[],
	opts: { file?: string },
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const compiled = await compileWorkflowSources(wanted, opts.file, options);
		if (!compiled) return 1;
		const matched = await withServerIds(
			deps,
			options,
			repo,
			compiled.context,
			compiled.definitions,
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

interface PushOptions {
	file?: string;
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
		return 0;
	}
	out(
		changeLines(output.data, options.style, (entry) =>
			[entry.id, entry.outcome, entry.url].filter(Boolean).join("  "),
		),
	);
	for (const entry of refused) {
		err(errorLine(refusalText(entry, repo), options.errStyle));
	}
	return 0;
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

function pushSourceFile(
	compiled: CompiledWorkflowSources,
	index: number,
): string {
	return (
		compiled.files[compiled.format === "sdk" ? index : 0] ?? compiled.context
	);
}

function duplicatePushNames(
	compiled: CompiledWorkflowSources,
	matched: MatchedWorkflows,
): string[] {
	if (compiled.format !== "sdk") return [];
	const filesByName = new Map<string, string[]>();
	const newNames = new Set<string>();
	for (const [index, definition] of compiled.definitions.entries()) {
		const files = filesByName.get(definition.name) ?? [];
		files.push(pushSourceFile(compiled, index));
		filesByName.set(definition.name, files);
		if (matched.matches[index]?.by === "new") newNames.add(definition.name);
	}
	return [...filesByName].flatMap(([name, files]) =>
		files.length > 1 && newNames.has(name)
			? [
					`Duplicate workflow name ${JSON.stringify(name)} in ${[...new Set(files)].join(", ")}. Give each workflow a different name.`,
				]
			: [],
	);
}

function pushWorkflows(
	deps: ManageDeps,
	command: Command,
	repo: string,
	wanted: string[],
	opts: PushOptions,
): Promise<void> {
	return workflowAction(command, deps, async (options) => {
		const compiled = await compileWorkflowSources(
			wanted,
			opts.file,
			options,
			true,
		);
		if (!compiled) return 1;
		if (compiled.format === "sdk") {
			for (const [index, file] of compiled.files.entries()) {
				const checked = await typecheckSdkWorkflow(file, deps.system);
				if (!checked.ok) {
					return fail(new Error(checked.message), options);
				}
				if (
					compiled.definitions[index]?.authoredSource !==
					readFileSync(file, "utf8")
				) {
					throw new Error(
						`${file} changed during compilation. Run push again.`,
					);
				}
			}
		}
		const matched = await withServerIds(
			deps,
			options,
			repo,
			compiled.context,
			compiled.definitions,
		);
		const duplicates = duplicatePushNames(compiled, matched);
		if (duplicates.length > 0) {
			return fail(new Error(duplicates.join("\n")), options);
		}
		if (opts.force) {
			return await applyDirect(deps, options, repo, compiled.context, matched);
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
			rememberIds(compiled.context, repo, matched);
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
				err(
					blockedText(
						proposal.workflows.map((workflow) => {
							const index = matched.definitions.findIndex(
								({ id }) => id === workflow.id,
							);
							const sourceIndex =
								index >= 0
									? index
									: matched.definitions.findIndex(
											({ name }) => name === workflow.name,
										);
							return {
								...workflow,
								file:
									sourceIndex >= 0
										? pushSourceFile(compiled, sourceIndex)
										: undefined,
							};
						}),
						options.errStyle,
					),
				);
			}
			return 1;
		}
		const { push } = proposal;
		if (options.json && !opts.wait) {
			out(JSON.stringify(push, null, 2));
			return 0;
		}
		if (!options.json) {
			const newNames = push.workflows
				.filter(({ change }) => change === "new")
				.map(({ name }) => JSON.stringify(name));
			if (newNames.length > 0) {
				const count = push.workflows.length;
				err(
					`New ${newNames.length === 1 ? "workflow" : "workflows"} detected: ${newNames.join(", ")}. Review ${count} ${count === 1 ? "change" : "changes"}. Accepting creates the new ${newNames.length === 1 ? "workflow" : "workflows"} from your local code.`,
				);
			}
			err(reviewLink(push.url, process.stderr.isTTY === true));
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
			rememberIds(compiled.context, repo, matched);
		}
		if (options.json && ["accepted", "rejected"].includes(final.status)) {
			out(JSON.stringify(final));
		} else if (options.json) {
			err(
				JSON.stringify({
					error: {
						code: "PUSH_NOT_COMPLETED",
						message: pushRefusalText(final, repo),
						details: final,
					},
				}),
			);
		} else if (final.status === "accepted") {
			out(outcomeText(final, options.style));
		} else {
			err(errorLine(pushRefusalText(final, repo), options.errStyle));
		}
		return final.status === "accepted" || final.status === "rejected" ? 0 : 1;
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
	return args;
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
	return command
		.option("--name <name>", "The rule's name")
		.option(
			"--definition <json>",
			"The rule as JSON, or @ and the path to a JSON file",
		)
		.option("--description <text>", "Why the rule exists")
		.option("--enable", "Install the rule")
		.option("--disable", "Uninstall the rule")
		.addHelpText("after", CUSTOM_RULE_HELP);
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

	const rules = program
		.command("rules")
		.description("Read and change rules")
		.action((_options, command: Command) => command.outputHelp());
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
	rules
		.command("set <repoOrRule> [ruleId]")
		.usage("[options] [repo] <ruleId>")
		.description(
			"Install or uninstall a rule and set its params. A custom rule has no params",
		)
		.option("--enable", "Install the rule")
		.option("--disable", "Uninstall the rule")
		.option(
			"--param <key=value>",
			"Set a param, repeatable. Values parse as JSON when they can",
			(value: string, previous: string[]) => [...previous, value],
			[],
		)
		.action(
			(
				first: string,
				second: string | undefined,
				opts: { enable?: boolean; disable?: boolean; param: string[] },
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
				return withRepo(deps, command, repo, (target) =>
					runTool(deps, command, "set_rule", { repo: target, ...args }),
				);
			},
		);

	customRuleFlags(
		rules
			.command("create [repo]")
			.description(
				"Create a custom rule. Install it with --enable or use it in tripwire.ts with customCheck",
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
						"Pass --name, --definition, --description, --enable or --disable.",
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

	const gate = program
		.command("gate")
		.description("Control the Tripwire gate on a repo")
		.action((_options, command: Command) => command.outputHelp());
	gate
		.command("on [repo]")
		.description("Turn the gate on for a repo")
		.action((repo: string | undefined, _options, command: Command) =>
			withRepo(deps, command, repo, (target) =>
				runTool(deps, command, "turn_on_gate", { repo: target }),
			),
		);

	const workflows = program
		.command("workflows")
		.description("Manage typed workflow files: pull, validate, diff and push")
		.action((_options, command: Command) => command.outputHelp());
	workflows
		.command("pull [workflows...]")
		.description("Write one SDK file per workflow in .tripwire/workflows")
		.option("--file <path>", "Explicit legacy tripwire.ts collection output")
		.option("--repo <repo>", "Repository to pull; defaults to the project link")
		.option("--force", "Replace selected files that have local edits")
		.option("--no-link", "Do not save the repo to .tripwire/project.json")
		.action(
			(
				wanted: string[],
				opts: PullOptions & { repo?: string },
				command: Command,
			) =>
				withRepo(deps, command, opts.repo, (target) =>
					pullWorkflows(deps, command, target, wanted, opts),
				),
		);
	workflows
		.command("validate [workflows...]")
		.description(
			"Compile workflow files and optionally check them against a repository",
		)
		.option(
			"--file <path>",
			"One SDK workflow file, or an explicit legacy tripwire.ts",
		)
		.option(
			"--repo <repo>",
			"Also check against this repo, custom rules included",
		)
		.action(
			(
				wanted: string[],
				opts: { file?: string; repo?: string },
				command: Command,
			) => validateWorkflows(deps, command, wanted, opts),
		);
	workflows
		.command("diff [workflows...]")
		.description("Show what selected workflow files would change")
		.option(
			"--file <path>",
			"One SDK workflow file, or an explicit legacy tripwire.ts",
		)
		.option(
			"--repo <repo>",
			"Repository to compare; defaults to the project link",
		)
		.action(
			(
				wanted: string[],
				opts: { file?: string; repo?: string },
				command: Command,
			) =>
				withRepo(deps, command, opts.repo, (target) =>
					diffWorkflows(deps, command, target, wanted, opts),
				),
		);
	workflows
		.command("push [workflows...]")
		.description(
			"Send selected workflow files for review. New workflows start off",
		)
		.option(
			"--file <path>",
			"One SDK workflow file, or an explicit legacy tripwire.ts",
		)
		.option("--repo <repo>", "Repository to push; defaults to the project link")
		.option("--force", "Save without review")
		.option("--no-browser", "Print the review link without opening a browser")
		.option("--wait", "With --json, wait for the review")
		.action(
			(
				wanted: string[],
				opts: PushOptions & { repo?: string },
				command: Command,
			) =>
				withRepo(deps, command, opts.repo, (target) =>
					pushWorkflows(deps, command, target, wanted, opts),
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

	const runs = program
		.command("runs")
		.description("Inspect runs")
		.action((_options, command: Command) => command.outputHelp());
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
		.description("Work the human review queue")
		.action((_options, command: Command) => command.outputHelp());
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
