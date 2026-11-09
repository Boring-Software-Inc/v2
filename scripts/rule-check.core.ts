/**
 * rule-check core — evaluate ONE rule against a real PR and report what actually
 * happened. Structured as callable functions (checkRule / listRules) so a future
 * server-side "test this rule" button can reuse them; the CLI (rule-check.ts) is
 * a thin wrapper.
 *
 * A single-rule run is a synthetic one-node workflow (trigger → rule, NO action
 * nodes) fed to the real `executeWorkflow`. The executor is pure, so nothing is
 * persisted: this cannot touch the PR, the activity feed, stats, or insights.
 * Evaluation reuses the worker's own path (buildRuleContext + makeEvaluator +
 * customRuleSource) so it can never drift from what the worker does.
 */
import {
	customRuleRecordSchema,
	type RepoScopedEvent,
	type ResolvedCatalogEntry,
	RULE_CATALOG,
	type RuleResult,
	resolveCatalog,
	ruleIdOf,
	storedJsonValueSchema,
	validateWorkflowForEnable,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { executeWorkflow } from "@tripwire/core";
import { type Db, repoServices, workflowServices } from "@tripwire/db";
import {
	GithubHttp,
	GithubReads,
	githubForge,
	InstallationTokenCache,
	normalizeWebhook,
} from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { z } from "zod";
import { buildRuleContext } from "../apps/worker/src/context.ts";
import { customRuleSource } from "../apps/worker/src/jobs/custom-rules.ts";
import {
	floorStepsOf,
	makeEvaluator,
} from "../apps/worker/src/jobs/run-workflows.ts";
// @tripwire/sdk is not linked at the repo root (scripts/ declares no deps and we
// must not touch bun.lock), so reach it by path — same as the worker internals.
import {
	createForgeSignalCtx,
	type ProducerMap,
	SignalUnavailableError,
} from "../packages/sdk/src/index.ts";

// A silent logger sink — this tool reports through its result, not logs. Proxy
// so every logger method (and `child`) is a no-op, without a runtime pino dep
// (pino is not linked at the repo root).
const logger: Logger = new Proxy({} as Logger, {
	get(_target, prop) {
		return prop === "child" ? () => logger : () => undefined;
	},
});

interface GithubSignalProducers {
	[id: string]: ProducerMap<GithubHttp>[keyof ProducerMap<GithubHttp>];
}

export interface SignalReport {
	id: string;
	resolved: boolean;
	/** Raw producer value (pre-transform) when resolved. */
	value?: unknown;
	/** Verbatim producer reason when unavailable. */
	reason?: string;
}

export interface CheckResult {
	ref: string;
	name: string;
	source: "built-in" | "custom";
	status: "evaluated" | "skipped";
	passed: boolean;
	/** The rule's stored evidence (post-transform observed value for custom). */
	evidence: unknown;
	/** Verbatim skip reason, or null when evaluated. THE headline. */
	skipReason: string | null;
	/** Per-signal resolution — a custom rule reads exactly one signal. */
	signals: SignalReport[];
	/** Built-in context reads that came back unavailable (the built-in analog). */
	degradedReads: string[];
}

function buildForge(db: Db) {
	const appId = process.env.GITHUB_APP_ID;
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll(
		"\\n",
		"\n",
	);
	if (!appId || !privateKey) {
		throw new Error(
			"GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required (run with --env-file=.env.production)",
		);
	}
	const tokens = new InstallationTokenCache({ appId, privateKey });
	const tokenFor = async (repoFullName: string) => {
		const repo = await repoServices.getRepoByFullName(
			db,
			repoFullName,
			"github",
		);
		if (!repo?.installationId) {
			throw new Error(`no installation for ${repoFullName}`);
		}
		return tokens.getToken(repo.installationId);
	};
	const httpOptions = { appId: Number(appId), tokenFor };
	return {
		reads: new GithubReads(httpOptions),
		signalHttp: new GithubHttp(httpOptions),
	};
}

/** Fetch the PR and run it through the REAL webhook normalizer, so every event
 * field matches production exactly (no hand-rolled event to drift). */
async function fetchPrEvent(
	http: GithubHttp,
	repoFullName: string,
	prNumber: number,
	now: string,
): Promise<RepoScopedEvent> {
	const [owner, name] = repoFullName.split("/");
	const pr = (await http.get(
		repoFullName,
		`/repos/${owner}/${name}/pulls/${prNumber}`,
	)) as { base: { repo: unknown }; user: unknown };
	const event = normalizeWebhook(
		{
			deliveryId: `rule-check-${repoFullName}#${prNumber}`,
			eventName: "pull_request",
			signature: "",
			body: JSON.stringify({
				action: "opened",
				pull_request: pr,
				repository: pr.base.repo,
				sender: pr.user,
			}),
		},
		now,
	);
	if (!event || !("repo" in event)) {
		throw new Error(`could not normalize PR ${repoFullName}#${prNumber}`);
	}
	return event;
}

const issueReadSchema = z
	.object({
		user: z.unknown(),
		pull_request: z.unknown().optional(),
	})
	.passthrough();

async function fetchIssueEvent(
	http: GithubHttp,
	repo: string,
	number: number,
	now: string,
): Promise<RepoScopedEvent> {
	const issue = issueReadSchema.parse(
		await http.get(repo, `/repos/${repo}/issues/${number}`),
	);
	if (issue.pull_request !== undefined) {
		throw new Error(`${repo}#${number} is a pull request. Use --pr.`);
	}
	const repository = await http.get(repo, `/repos/${repo}`);
	const event = normalizeWebhook(
		{
			deliveryId: `workflow-preview-${repo}#${number}`,
			eventName: "issues",
			signature: null,
			body: JSON.stringify({
				action: "opened",
				issue,
				repository,
				sender: issue.user,
			}),
		},
		now,
	);
	if (event?.kind !== "issue.opened") {
		throw new Error(`Could not read issue ${repo}#${number}.`);
	}
	return event;
}

export async function checkWorkflow(input: {
	db: Db;
	repo: string;
	number: number;
	kind: "issue" | "pr";
	workflowId: string;
}) {
	const { db, repo: fullName, number, kind, workflowId } = input;
	const repo = await repoServices.getRepoByFullName(db, fullName, "github");
	if (!repo) throw new Error(`Repository not found. ${fullName}`);
	const workflow = await workflowServices.getWorkflow(db, {
		repoId: repo.id,
		workflowId,
	});
	if (!workflow) throw new Error(`Workflow not found. ${workflowId}`);
	const { rows, catalog } = await loadCatalog(db, repo.id);
	const validation = validateWorkflowForEnable(workflow.definition, catalog);
	if (!validation.valid) {
		throw new Error(validation.issues.map((issue) => issue.message).join(" "));
	}
	const now = new Date().toISOString();
	const { reads, signalHttp } = buildForge(db);
	const event = await (kind === "issue"
		? fetchIssueEvent(signalHttp, fullName, number, now)
		: fetchPrEvent(signalHttp, fullName, number, now));
	const { definition } = validation;
	if (
		!definition.nodes.some(
			(node) => node.type === "trigger" && node.kinds.includes(event.kind),
		)
	) {
		throw new Error(`This workflow does not run on ${event.kind}.`);
	}
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		reads,
		now,
		logger,
	);
	const custom = customRuleSource(
		rows,
		createForgeSignalCtx({ forge: signalHttp, event, now }),
	);
	const result = await executeWorkflow({
		definition,
		event,
		evaluateRuleRef: makeEvaluator(ctx, logger, custom),
		now: () => now,
	});
	const skippedChecks = floorStepsOf(
		[definition],
		result.steps
			.filter((step) => step.nodeKind === "rule")
			.map((step) => ({ ...step, nodeId: `${definition.id}:${step.nodeId}` })),
	).some((step) => step.status === "skipped");
	return {
		event: event.kind,
		armed: repo.armed,
		enabled: workflow.enabled,
		exempt: Boolean(
			(event.kind === "issue.opened" && event.issue.maintainer) ||
				ctx.contributor?.isMaintainer ||
				ctx.contributor?.isOrgMember,
		),
		contributorAvailable:
			ctx.contributor?.isMaintainer != null &&
			!degradedReads.includes("contributor"),
		evaluation: result.verdict,
		degradedReads,
		skippedChecks,
		steps: result.steps.map(({ nodeId, nodeKind, status }) => ({
			nodeId,
			nodeKind,
			status,
		})),
		plannedActions: result.actions.map(({ action, nodeId }) => ({
			action,
			nodeId,
		})),
	};
}

async function loadCatalog(db: Db, repoId: string) {
	const rows = await repoServices.listCustomRules(db, repoId);
	const parsed = rows.flatMap((row) => {
		const result = customRuleRecordSchema.safeParse(row);
		return result.success ? [result.data] : [];
	});
	return { rows, parsed, catalog: resolveCatalog(parsed) };
}

/** Resolve `--rule` — an exact ref, or an unambiguous display name. */
function resolveRef(
	input: string,
	catalog: ResolvedCatalogEntry[],
): ResolvedCatalogEntry {
	const byRef = catalog.find(
		(e) => `${e.ruleId}@${e.version}` === input || e.ruleId === ruleIdOf(input),
	);
	if (byRef) {
		return byRef;
	}
	const byName = catalog.filter(
		(e) => e.name.toLowerCase() === input.toLowerCase(),
	);
	if (byName.length === 1) {
		return byName[0] as ResolvedCatalogEntry;
	}
	if (byName.length > 1) {
		throw new Error(
			`ambiguous name "${input}" — matches ${byName
				.map((e) => `${e.ruleId}@${e.version}`)
				.join(", ")}`,
		);
	}
	throw new Error(`unknown rule "${input}" — run --list to see available refs`);
}

export async function listRules(input: {
	db: Db;
	repo: string;
}): Promise<{ ref: string; name: string; source: string }[]> {
	const repo = await repoServices.getRepoByFullName(
		input.db,
		input.repo,
		"github",
	);
	if (!repo) {
		throw new Error(`repo not found: ${input.repo}`);
	}
	const { catalog } = await loadCatalog(input.db, repo.id);
	return catalog.map((e) => ({
		ref: `${e.ruleId}@${e.version}`,
		name: e.name,
		source: e.source,
	}));
}

export async function checkRule(input: {
	db: Db;
	repo: string;
	ruleRef: string;
	pr: number;
}): Promise<CheckResult> {
	const { db, repo: repoFullName, ruleRef: rawRef, pr } = input;
	const now = new Date().toISOString();

	const repo = await repoServices.getRepoByFullName(db, repoFullName, "github");
	if (!repo) {
		throw new Error(`repo not found: ${repoFullName}`);
	}

	const { rows, parsed, catalog } = await loadCatalog(db, repo.id);
	const entry = resolveRef(rawRef, catalog);
	const ref = `${entry.ruleId}@${entry.version}`;

	/** Custom rules have no config; built-ins prefer stored config to catalog defaults. */
	const config =
		entry.source === "built-in"
			? ((await repoServices.listRuleConfigs(db, repo.id)).find(
					(c) => c.ruleId === entry.ruleId,
				)?.config ??
				RULE_CATALOG.find((e) => e.ruleId === entry.ruleId)?.defaultConfig ??
				{})
			: {};

	const parsedConfig = storedJsonValueSchema.safeParse(config);
	if (!parsedConfig.success) {
		return {
			ref,
			name: entry.name,
			source: entry.source,
			status: "skipped",
			passed: false,
			evidence: null,
			skipReason: "Stored rule config is not valid JSON.",
			signals: [],
			degradedReads: [],
		};
	}

	const { reads, signalHttp } = buildForge(db);
	const event = await fetchPrEvent(signalHttp, repoFullName, pr, now);

	const signalCtx = createForgeSignalCtx({ forge: signalHttp, event, now });
	const custom = customRuleSource(rows, signalCtx);
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		reads,
		now,
		logger,
	);
	const evaluate = makeEvaluator(ctx, logger, custom);

	// The synthetic one-node workflow: trigger → rule, NO actions. Structurally
	// cannot comment, check, block, or notify.
	const definition: WorkflowDefinition = {
		id: "rule-check",
		name: "rule-check",
		version: 1,
		nodes: [
			{ id: "trigger", type: "trigger", kinds: [event.kind] },
			{ id: "rule", type: "rule", ref, config: parsedConfig.data },
		],
		edges: [{ id: "e1", from: "trigger", to: "rule" }],
	};

	const result = await executeWorkflow({
		definition,
		event,
		evaluateRuleRef: evaluate,
		now: () => now,
	});
	const step = result.steps.find((s) => s.nodeKind === "rule");
	const ruleResult = step?.output as RuleResult | undefined;

	// Per-signal detail. A custom rule reads exactly one signal (`when.id`); call
	// its producer directly (memoized via ctx.load — no extra fetch) to surface
	// the RAW value or the verbatim unavailable reason.
	const signals: SignalReport[] = [];
	if (entry.source === "custom") {
		const signalId = parsed.find((c) => c.id === entry.ruleId)?.definition.when
			.id;
		if (signalId) {
			const producers: GithubSignalProducers = githubForge.produces;
			const producer = producers[signalId];
			const report: SignalReport = { id: signalId, resolved: false };
			if (producer) {
				try {
					report.value = await producer(signalCtx);
					report.resolved = true;
				} catch (error) {
					report.reason =
						error instanceof SignalUnavailableError
							? error.message
							: getErrorMessage(error);
				}
			}
			signals.push(report);
		}
	}

	return {
		ref,
		name: entry.name,
		source: entry.source,
		status: ruleResult?.status ?? "skipped",
		passed: ruleResult?.passed ?? false,
		evidence: ruleResult?.evidence ?? null,
		skipReason:
			ruleResult?.status === "skipped" ? (ruleResult.reason ?? null) : null,
		signals,
		degradedReads,
	};
}
