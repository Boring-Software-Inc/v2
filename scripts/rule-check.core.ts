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
	type NormalizedEvent,
	type ResolvedCatalogEntry,
	resolveCatalog,
	RULE_CATALOG,
	type RuleResult,
	ruleIdOf,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { executeWorkflow } from "@tripwire/core";
import { type Db, repoServices } from "@tripwire/db";
import {
	GithubHttp,
	githubForge,
	GithubReads,
	InstallationTokenCache,
	normalizeWebhook,
} from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
// @tripwire/sdk is not linked at the repo root (scripts/ declares no deps and we
// must not touch bun.lock), so reach it by path — same as the worker internals.
import {
	createForgeSignalCtx,
	SignalUnavailableError,
} from "../packages/sdk/src/index.ts";
import { buildRuleContext } from "../apps/worker/src/context.ts";
import { customRuleSource } from "../apps/worker/src/jobs/custom-rules.ts";
import { makeEvaluator } from "../apps/worker/src/jobs/run-workflows.ts";

// A silent logger sink — this tool reports through its result, not logs. Proxy
// so every logger method (and `child`) is a no-op, without a runtime pino dep
// (pino is not linked at the repo root).
const logger: Logger = new Proxy({} as Logger, {
	get(_target, prop) {
		return prop === "child" ? () => logger : () => undefined;
	},
});

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

function buildForge(db: Db): { reads: GithubReads; signalHttp: GithubHttp } {
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
		const repo = await repoServices.getRepoByFullName(db, repoFullName);
		if (!repo?.installationId) {
			throw new Error(`no installation for ${repoFullName}`);
		}
		return tokens.getToken(repo.installationId);
	};
	const httpOptions = { tokenFor };
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
): Promise<NormalizedEvent> {
	const [owner, name] = repoFullName.split("/");
	const pr = (await http.get(
		repoFullName,
		`/repos/${owner}/${name}/pulls/${prNumber}`,
	)) as { base: { repo: unknown }; user: unknown };
	const event = normalizeWebhook(
		{
			deliveryId: `rule-check-${repoFullName}#${prNumber}`,
			eventName: "pull_request",
			body: JSON.stringify({
				action: "opened",
				pull_request: pr,
				repository: pr.base.repo,
				sender: pr.user,
			}),
		},
		now,
	);
	if (!event) {
		throw new Error(`could not normalize PR ${repoFullName}#${prNumber}`);
	}
	return event;
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
	const repo = await repoServices.getRepoByFullName(input.db, input.repo);
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

	const repo = await repoServices.getRepoByFullName(db, repoFullName);
	if (!repo) {
		throw new Error(`repo not found: ${repoFullName}`);
	}

	const { rows, parsed, catalog } = await loadCatalog(db, repo.id);
	const entry = resolveRef(rawRef, catalog);
	const ref = `${entry.ruleId}@${entry.version}`;

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

	// Effective config: the repo's stored config for a built-in, else its catalog
	// default. Custom rules carry no config — the rule IS the config.
	let config: unknown = {};
	if (entry.source === "built-in") {
		const stored = (await repoServices.listRuleConfigs(db, repo.id)).find(
			(c) => c.ruleId === entry.ruleId,
		);
		const catalogEntry = RULE_CATALOG.find((e) => e.ruleId === entry.ruleId);
		config = stored?.config ?? catalogEntry?.defaultConfig ?? {};
	}

	// The synthetic one-node workflow: trigger → rule, NO actions. Structurally
	// cannot comment, check, block, or notify.
	const definition: WorkflowDefinition = {
		id: "rule-check",
		name: "rule-check",
		version: 1,
		nodes: [
			{ id: "trigger", type: "trigger", kinds: [event.kind] },
			{ id: "rule", type: "rule", ref, config },
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
			const producer = githubForge.produces[signalId];
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
