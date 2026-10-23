import {
	edgePort,
	foldGate,
	type NodeOutcome,
	type NormalizedEvent,
	portValue,
	type RuleResult,
	type Verdict,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@tripwire/contracts";

/**
 * The boring DAG walk (§6): topo order, gate short-circuit, every node's
 * input/output recorded as a step. Pure — rule evaluation arrives injected so
 * the executor never touches the registry, the adapter, or the clock directly.
 */

export interface StepRecord {
	nodeId: string;
	nodeKind: WorkflowNode["type"];
	/** `id@version` for rule nodes. */
	ruleRef?: string;
	/**
	 * pass | fail | skipped (rule couldn't evaluate) | disabled (rule toggled
	 * off for the repo — conducts as pass, off the degradation floor, §6) |
	 * paused | not-reached
	 */
	status: "pass" | "fail" | "skipped" | "disabled" | "paused";
	input: unknown;
	output: unknown;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
}

export interface ExecutionResult {
	verdict: Verdict;
	steps: StepRecord[];
	/** Set when a send-to-moderation node paused the run. */
	pausedAtNodeId: string | null;
	/** Action nodes that conducted, in topo order — step 7 executes these. */
	actions: {
		nodeId: string;
		action: string;
		params: Record<string, unknown>;
	}[];
	/** Node outcomes, persisted for resume. */
	outcomes: Record<string, NodeOutcome>;
}

export interface ExecuteWorkflowOptions {
	definition: WorkflowDefinition;
	event: NormalizedEvent;
	/** Injected: evaluates `ref` with `config` over the pre-built RuleContext. */
	evaluateRuleRef: (ref: string, config: unknown) => Promise<RuleResult>;
	/** Injected clock for step timings. */
	now: () => string;
	/**
	 * Resume (§6 moderation): prior outcomes from the paused run plus the
	 * decision for the node that paused it.
	 */
	resume?: {
		outcomes: Record<string, NodeOutcome>;
		nodeId: string;
		decision: "approve" | "deny";
	};
	/**
	 * Optional live progress hook (worker injects persist + notify). Called
	 * after each step is recorded; core stays pure — no I/O here.
	 */
	onStep?: (step: StepRecord) => void | Promise<void>;
}

function topoOrder(def: WorkflowDefinition): WorkflowNode[] {
	const indegree = new Map<string, number>(def.nodes.map((n) => [n.id, 0]));
	for (const edge of def.edges) {
		indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
	}
	const byId = new Map(def.nodes.map((n) => [n.id, n]));
	const queue = def.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
	const order: WorkflowNode[] = [];
	while (queue.length > 0) {
		const node = queue.shift() as WorkflowNode;
		order.push(node);
		for (const edge of def.edges.filter((e) => e.from === node.id)) {
			const remaining = (indegree.get(edge.to) ?? 1) - 1;
			indegree.set(edge.to, remaining);
			if (remaining === 0) {
				const next = byId.get(edge.to);
				if (next) {
					queue.push(next);
				}
			}
		}
	}
	return order;
}

export async function executeWorkflow(
	options: ExecuteWorkflowOptions,
): Promise<ExecutionResult> {
	const { definition, event, evaluateRuleRef, now, resume, onStep } = options;
	const outcomes = new Map<string, NodeOutcome>(
		Object.entries(resume?.outcomes ?? {}),
	);
	const conducted = new Set<string>();
	const byId = new Map(definition.nodes.map((n) => [n.id, n]));
	const steps: StepRecord[] = [];
	const actions: ExecutionResult["actions"] = [];
	let pausedAtNodeId: string | null = null;
	let blocked = false;

	type EdgeValue = NodeOutcome | "unreached";

	const edgeValue = (edge: WorkflowDefinition["edges"][number]): EdgeValue => {
		const source = outcomes.get(edge.from);
		const from = byId.get(edge.from);
		if (source === undefined || !conducted.has(edge.from) || !from) {
			return "unreached";
		}
		const when = edge.when ?? "pass";
		if (when === "approve" || when === "deny") {
			const decided =
				resume !== undefined &&
				edge.from === resume.nodeId &&
				when === (resume.decision === "approve" ? "approve" : "deny");
			return decided ? "pass" : "fail";
		}
		return portValue(edgePort(from, edge.when), source);
	};

	const incomingEdges = (nodeId: string) =>
		definition.edges.filter((e) => e.to === nodeId);

	const record = async (
		node: WorkflowNode,
		status: StepRecord["status"],
		input: unknown,
		output: unknown,
		startedAt: string,
	): Promise<void> => {
		const finishedAt = now();
		const step: StepRecord = {
			nodeId: node.id,
			nodeKind: node.type,
			ruleRef: node.type === "rule" ? node.ref : undefined,
			status,
			input,
			output,
			startedAt,
			finishedAt,
			durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
		};
		steps.push(step);
		await onStep?.(step);
	};

	for (const node of topoOrder(definition)) {
		if (pausedAtNodeId) {
			break;
		}
		const startedAt = now();

		if (node.type === "trigger") {
			const matches =
				node.kinds.includes(event.kind) &&
				(event.kind !== "schedule.matched" ||
					node.id === event.schedule.nodeId);
			const resuming = resume !== undefined;
			const firedBeforePause = resume?.outcomes[node.id] === "pass";
			if (resuming ? firedBeforePause : matches) {
				outcomes.set(node.id, "pass");
				conducted.add(node.id);
				if (!resuming) {
					await record(
						node,
						"pass",
						{ kinds: node.kinds },
						{ matched: matches },
						startedAt,
					);
				}
			}
			continue;
		}

		const isResumeTarget = resume?.nodeId === node.id;
		if (resume && outcomes.has(node.id) && !isResumeTarget) {
			conducted.add(node.id);
			continue;
		}

		const incoming = incomingEdges(node.id).map((edge) => ({
			edge,
			value: edgeValue(edge),
		}));
		const values = incoming.map((input) => input.value);
		const reached =
			node.type === "gate"
				? values.some((value) => value !== "unreached")
				: values.includes("pass");
		if (!(reached || isResumeTarget)) {
			if (values.includes("skipped")) {
				outcomes.set(node.id, "skipped");
				conducted.add(node.id);
				await record(
					node,
					"skipped",
					{ unreached: "unknown" },
					{ reason: "An earlier step could not run." },
					startedAt,
				);
			}
			continue;
		}

		if (node.type === "rule") {
			// A rule placed in a workflow is OWNED by the workflow (§6): it is
			// active because it is wired, regardless of its standalone /rules
			// toggle. The toggle governs only standalone use, applied by the
			// worker as it derives the default over non-workflowed rules.
			const result = await evaluateRuleRef(node.ref, node.config);
			const outcome: NodeOutcome =
				result.status === "skipped"
					? "skipped"
					: result.passed
						? "pass"
						: "fail";
			outcomes.set(node.id, outcome);
			conducted.add(node.id);
			await record(
				node,
				outcome,
				{ ref: node.ref, config: node.config },
				result,
				startedAt,
			);
			continue;
		}

		if (node.type === "gate") {
			const inputs = incoming.map(({ edge, value }) => {
				const from = byId.get(edge.from);
				const port = from ? edgePort(from, edge.when) : "pass";
				return value === "unreached"
					? { from: edge.from, port, outcome: "fail" as const, reached: false }
					: { from: edge.from, port, outcome: value };
			});
			const outcome = foldGate(
				node.mode,
				inputs.map((input) => input.outcome),
			);
			outcomes.set(node.id, outcome);
			conducted.add(node.id);
			await record(
				node,
				outcome,
				{ mode: node.mode, inputs },
				{ outcome },
				startedAt,
			);
			continue;
		}

		if (node.action === "send-to-moderation" && !isResumeTarget) {
			outcomes.set(node.id, "pass");
			conducted.add(node.id);
			pausedAtNodeId = node.id;
			await record(node, "paused", { action: node.action }, null, startedAt);
			continue;
		}

		if (isResumeTarget) {
			outcomes.set(node.id, "pass");
			conducted.add(node.id);
			await record(
				node,
				"pass",
				{ action: node.action, decision: resume?.decision },
				null,
				startedAt,
			);
			continue;
		}

		outcomes.set(node.id, "pass");
		conducted.add(node.id);
		if (node.action === "block") {
			blocked = true;
		}
		actions.push({
			nodeId: node.id,
			action: node.action,
			params: node.params ?? {},
		});
		await record(
			node,
			"pass",
			{ action: node.action, params: node.params },
			null,
			startedAt,
		);
	}

	const verdict: Verdict = pausedAtNodeId
		? "needs_review"
		: blocked
			? "block"
			: "pass";

	return {
		verdict,
		steps,
		pausedAtNodeId,
		actions,
		outcomes: Object.fromEntries(outcomes),
	};
}
