import type {
	NormalizedEvent,
	RepoScopedEvent,
	RuleResult,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import {
	normalizedEventSchema,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { executeWorkflow } from "@tripwire/core";
import { createDb, type Db } from "@tripwire/db";
import { normalizeWebhook } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import pino from "pino";
import { z } from "zod";
import { worstVerdict } from "./run-workflows.ts";

/**
 * §11 verdict replay — rerun the CURRENT engine over stored runs and diff the
 * derived verdicts against what was decided at the time. The flip report is a
 * review artifact for humans; the job fails ONLY on crash, never on flips.
 *
 * Replay is offline by construction: the event is re-normalized from the
 * stored raw payload with the current normalizer (falling back to the stored
 * normalized form), rule evaluations are replayed from the run's recorded
 * step envelopes (what the rule actually SAW — never a live GitHub read), and
 * the run's own workflow SNAPSHOT is re-executed through the current
 * executor, degradation floor, and resume/deny-floor semantics. A node whose
 * evaluation was never captured replays as
 * `skipped: replay — evaluation not captured` (honest degradation).
 */

export interface ReplayBundle {
	runId: string;
	storedVerdict: Verdict;
	snapshot: WorkflowDefinition[];
	event: RepoScopedEvent;
	/** Original (non-`:resume`) steps: node id as stored, envelope in output. */
	steps: {
		nodeId: string;
		nodeKind: string;
		status: string;
		output: unknown;
	}[];
	/** Latest moderation decision on the run, when one was made. */
	decision: "approve" | "deny" | null;
	/** The moderation item's node id (`wf:node` or `run:degraded`). */
	decisionNodeId: string | null;
}

export interface FlipEntry {
	runId: string;
	oldVerdict: Verdict;
	newVerdict: Verdict;
	/** The semantics change or rule@version responsible, best-effort. */
	responsible: string;
	/** What differs between the stored walk and the replayed walk. */
	evidenceDelta: string;
	failedRules: string[];
}

export interface ReplayReport {
	replayedAt: string;
	total: number;
	unchanged: number;
	skipped: { runId: string; reason: string }[];
	flips: FlipEntry[];
}

const bundleSchema = z.object({
	runId: z.string(),
	storedVerdict: z.enum(["pass", "block", "needs_review"]),
	snapshot: z.array(workflowDefinitionSchema),
	event: normalizedEventSchema,
	steps: z.array(
		z.object({
			nodeId: z.string(),
			nodeKind: z.string(),
			status: z.string(),
			output: z.unknown(),
		}),
	),
	decision: z.enum(["approve", "deny"]).nullable(),
	decisionNodeId: z.string().nullable(),
});

function replayEvaluator(bundle: ReplayBundle, wfId: string) {
	const stored = new Map<string, RuleResult>();
	for (const step of bundle.steps) {
		if (step.nodeKind !== "rule" || !step.nodeId.startsWith(`${wfId}:`)) {
			continue;
		}
		const local = step.nodeId.slice(wfId.length + 1);
		stored.set(`${local}`, step.output as RuleResult);
	}
	const byNode = (nodeId: string): RuleResult | undefined => stored.get(nodeId);
	return { byNode };
}

/** Replay one stored run through the current engine. Pure over the bundle. */
export async function replayBundle(
	bundle: ReplayBundle,
): Promise<{ newVerdict: Verdict; flip: FlipEntry | null }> {
	const now = () => new Date().toISOString();
	const verdicts: Verdict[] = [];
	let pausedWf: WorkflowDefinition | null = null;
	let pausedNode: string | null = null;
	let pausedOutcomes: Record<string, "pass" | "fail"> = {};
	let gateReachabilityChanged = false;
	let skippedRules = 0;
	let ruleNodes = 0;
	const failedRules: string[] = [];

	for (const definition of bundle.snapshot) {
		const { byNode } = replayEvaluator(bundle, definition.id);
		/**
		 * The executor asks by ref; envelopes were stored by node. Track the
		 * walk order so multi-node-same-rule graphs still map correctly.
		 */
		const result = await executeWorkflow({
			definition,
			event: bundle.event,
			evaluateRuleRef: (ref: string, _config: unknown): Promise<RuleResult> => {
				const node = definition.nodes.find(
					(n) => n.type === "rule" && n.ref === ref && byNode(n.id),
				);
				const envelope = node ? byNode(node.id) : undefined;
				return Promise.resolve(
					envelope ?? {
						ruleId: ref.split("@")[0] ?? ref,
						version: Number(ref.split("@")[1] ?? 1) || 1,
						status: "skipped",
						passed: false,
						evidence: null,
						reason: "replay — evaluation not captured",
						evaluatedAt: now(),
					},
				);
			},
			now,
		});
		verdicts.push(result.verdict);
		const ruleSteps = result.steps.filter((s) => s.nodeKind === "rule");
		ruleNodes += ruleSteps.length;
		skippedRules += ruleSteps.filter((s) => s.status === "skipped").length;
		for (const s of ruleSteps) {
			if (s.status === "fail" && s.ruleRef) {
				failedRules.push(s.ruleRef);
			}
		}
		if (result.pausedAtNodeId) {
			pausedWf = definition;
			pausedNode = result.pausedAtNodeId;
			pausedOutcomes = result.outcomes as Record<string, "pass" | "fail">;
		}
		const storedGateRan = bundle.steps.some(
			(s) => s.nodeKind === "gate" && s.nodeId.startsWith(`${definition.id}:`),
		);
		const replayGateRan = result.steps.some((s) => s.nodeKind === "gate");
		if (replayGateRan && !storedGateRan) {
			gateReachabilityChanged = true;
		}
	}

	let verdict = worstVerdict(verdicts);
	let paused = pausedNode !== null;

	/** The run-workflows fail-closed floor, replayed (§6 amendment). */
	const degraded =
		ruleNodes > 0 && skippedRules * 2 >= ruleNodes && verdict === "pass";
	if (degraded) {
		verdict = "needs_review";
		paused = true;
	}

	let denyFloored = false;
	if (paused && bundle.decision) {
		if (bundle.decisionNodeId === "run:degraded" || degraded) {
			verdict = bundle.decision === "approve" ? "pass" : "block";
		} else if (pausedWf && pausedNode) {
			const resumed = await executeWorkflow({
				definition: pausedWf,
				event: bundle.event,
				evaluateRuleRef: () =>
					Promise.reject(new Error("resume replays stored outcomes only")),
				now,
				resume: {
					outcomes: pausedOutcomes,
					nodeId: pausedNode,
					decision: bundle.decision,
				},
			});
			verdict = resumed.verdict;
			const hasDenyEdge = pausedWf.edges.some(
				(edge) => edge.from === pausedNode && edge.when === "deny",
			);
			if (bundle.decision === "deny" && !hasDenyEdge) {
				verdict = "block";
				denyFloored = true;
			}
		}
	}

	if (verdict === bundle.storedVerdict) {
		return { newVerdict: verdict, flip: null };
	}
	const responsible = denyFloored
		? "deny-floor resume semantics (unit 5) — deny with no deny edge now blocks"
		: gateReachabilityChanged
			? "gate reachability (unit 1) — gates now run once a source settles, failures included"
			: degraded
				? "fail-closed degradation floor"
				: "UNATTRIBUTED — investigate before shipping";
	return {
		newVerdict: verdict,
		flip: {
			runId: bundle.runId,
			oldVerdict: bundle.storedVerdict,
			newVerdict: verdict,
			responsible,
			evidenceDelta:
				"none — rule envelopes replayed verbatim from stored run_steps; only the walk changed",
			failedRules: [...new Set(failedRules)],
		},
	};
}

export async function loadBundlesFromDb(
	db: Db,
	limit: number | null,
): Promise<{ bundles: ReplayBundle[]; skipped: ReplayReport["skipped"] }> {
	const { runServices } = await import("@tripwire/db");
	const rows = await runServices.listRunsForReplay(db, limit);
	const bundles: ReplayBundle[] = [];
	const skipped: ReplayReport["skipped"] = [];
	for (const row of rows) {
		if (!row.verdict || row.status !== "completed") {
			skipped.push({ runId: row.id, reason: `status ${row.status}` });
			continue;
		}
		let event: NormalizedEvent | null = null;
		try {
			event = normalizeWebhook(
				{
					deliveryId: row.deliveryId,
					eventName: row.rawKind,
					body: JSON.stringify(row.raw),
					signature: null,
				},
				row.receivedAt.toISOString(),
			);
		} catch {
			event = null;
		}
		if (!event && row.normalized) {
			const parsed = normalizedEventSchema.safeParse(row.normalized);
			event = parsed.success ? parsed.data : null;
		}
		if (!event || !("repo" in event)) {
			skipped.push({ runId: row.id, reason: "event not replayable" });
			continue;
		}
		bundles.push({
			runId: row.id,
			storedVerdict: row.verdict as Verdict,
			snapshot: z.array(workflowDefinitionSchema).parse(row.workflowSnapshot),
			event,
			steps: row.steps
				.filter((s) => !s.nodeId.endsWith(":resume"))
				.map((s) => ({
					nodeId: s.nodeId,
					nodeKind: s.nodeKind,
					status: s.status,
					output: s.output,
				})),
			decision:
				row.decision === "approved"
					? "approve"
					: row.decision === "denied"
						? "deny"
						: null,
			decisionNodeId: row.decisionNodeId,
		});
	}
	return { bundles, skipped };
}

export async function replay(bundles: ReplayBundle[]): Promise<ReplayReport> {
	const report: ReplayReport = {
		replayedAt: new Date().toISOString(),
		total: bundles.length,
		unchanged: 0,
		skipped: [],
		flips: [],
	};
	for (const bundle of bundles) {
		try {
			const { flip } = await replayBundle(bundle);
			if (flip) {
				report.flips.push(flip);
			} else {
				report.unchanged += 1;
			}
		} catch (error) {
			report.skipped.push({
				runId: bundle.runId,
				reason: `replay error: ${getErrorMessage(error)}`,
			});
		}
	}
	return report;
}

export function parseCorpus(json: unknown): ReplayBundle[] {
	return z.array(bundleSchema).parse(json) as ReplayBundle[];
}

function renderReport(report: ReplayReport): string {
	const lines = [
		`verdict replay — ${report.total} runs · ${report.unchanged} unchanged · ${report.flips.length} flips · ${report.skipped.length} skipped`,
	];
	for (const flip of report.flips) {
		lines.push(
			`FLIP ${flip.runId}: ${flip.oldVerdict} → ${flip.newVerdict}`,
			`  responsible: ${flip.responsible}`,
			`  failed rules: ${flip.failedRules.join(", ") || "(none)"}`,
			`  evidence delta: ${flip.evidenceDelta}`,
		);
	}
	for (const s of report.skipped) {
		lines.push(`SKIPPED ${s.runId}: ${s.reason}`);
	}
	return lines.join("\n");
}

if (import.meta.main) {
	const logger = pino({ name: "replay" });
	const args = process.argv.slice(2);
	const argValue = (flag: string): string | null => {
		const i = args.indexOf(flag);
		return i !== -1 ? (args[i + 1] ?? null) : null;
	};
	const corpusPath = argValue("--corpus");
	const outPath = argValue("--out");
	const limitArg = argValue("--limit");

	let bundles: ReplayBundle[];
	let pool: { end(): Promise<void> } | null = null;
	let skippedLoads: ReplayReport["skipped"] = [];
	if (corpusPath) {
		bundles = parseCorpus(await Bun.file(corpusPath).json());
	} else {
		const created = createDb();
		pool = created.pool;
		const loaded = await loadBundlesFromDb(
			created.db,
			limitArg ? Number(limitArg) : null,
		);
		bundles = loaded.bundles;
		skippedLoads = loaded.skipped;
	}

	const report = await replay(bundles);
	report.skipped.unshift(...skippedLoads);
	console.log(renderReport(report));
	if (outPath) {
		await Bun.write(outPath, `${JSON.stringify(report, null, 2)}\n`);
		logger.info({ outPath }, "flip report artifact written");
	}
	if (argValue("--dump-corpus")) {
		await Bun.write(
			argValue("--dump-corpus") as string,
			`${JSON.stringify(bundles, null, 2)}\n`,
		);
	}
	await pool?.end();
	process.exit(0);
}
