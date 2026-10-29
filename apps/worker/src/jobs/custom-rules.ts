import {
	type CustomRuleRecord,
	customRuleRecordSchema,
	customRuleRef,
	customSignalDisplay,
	type RuleResult,
} from "@tripwire/contracts";
import { contextForge, type RuleContext } from "@tripwire/core";
import { type GithubHttp, githubForge } from "@tripwire/forge-github";
import {
	createForgeSignalCtx,
	evaluateSignalRule,
	type ForgeSignalCtx,
	SignalEvaluationError,
	type SignalRule,
	SignalUnavailableError,
} from "@tripwire/sdk";

/**
 * The data-defined registration path: a stored custom rule evaluates through
 * the SDK's generic evaluator over the GitHub forge's producers. No code
 * evaluate, no configSchema — the rule IS the config. Signals resolve
 * lazily through the shared memoized ctx, so a repo with no custom rules
 * pays zero extra API calls and N custom rules on one signal cluster share
 * one fetch.
 */

export type CustomSignalCtx = ForgeSignalCtx<GithubHttp>;

export interface CustomRuleSource {
	/** Every stored rule for the repo, keyed by ref ("custom-x@1"). A saved
	 * workflow may reference a standalone-disabled rule; ownership wins,
	 * exactly like built-in toggles. */
	records: Map<string, CustomRuleRecord>;
	/** Shared per-run signal ctx; null when forge reads are unavailable. */
	signalCtx: CustomSignalCtx | null;
}

export function customRuleSource(
	rows: readonly {
		id: string;
		name: string;
		enabled: boolean;
		definition: unknown;
	}[],
	signalCtx: CustomSignalCtx | null,
): CustomRuleSource {
	const records = new Map<string, CustomRuleRecord>();
	for (const row of rows) {
		const parsed = customRuleRecordSchema.safeParse(row);
		if (parsed.success) {
			records.set(customRuleRef(parsed.data.id), parsed.data);
		}
	}
	return { records, signalCtx };
}

function skipped(
	record: CustomRuleRecord,
	reason: string,
	now: string,
): RuleResult {
	return {
		ruleId: record.id,
		version: 1,
		status: "skipped",
		passed: false,
		evidence: null,
		reason,
		evaluatedAt: now,
	};
}

/**
 * One stored rule, one evaluation: the producer supplies the raw signal
 * value, evaluateSignalRule applies the transform and comparison, and the
 * evidence is the resolved value the verdict actually compared. Comparison
 * args (the maintainer's thresholds) stay out of evidence per §10.
 */
export async function evaluateCustomRule(
	record: CustomRuleRecord,
	signalCtx: CustomSignalCtx | null,
	now: string,
	/** Named only so a skip can say WHICH forge could not feed the rule. */
	forge?: string,
	context?: RuleContext,
): Promise<RuleResult> {
	/** GitCafe uses pre-fetched facts, never GitHub's network producers. */
	const producers: Record<string, (ctx: CustomSignalCtx) => unknown> =
		githubForge.produces;
	const contextProducer =
		forge === "gitcafe" && context
			? Object.entries(contextForge.produces).find(
					([id]) => id === record.definition.when.id,
				)?.[1]
			: undefined;
	const producer =
		forge === "gitcafe" ? undefined : producers[record.definition.when.id];
	if (!producer && !contextProducer) {
		const label = customSignalDisplay(record.definition.when.id)?.label;
		return skipped(
			record,
			label
				? `This rule uses "${label}", which this forge does not provide.`
				: "This rule uses data that this forge does not provide.",
			now,
		);
	}
	if ((!signalCtx || !producer) && (!contextProducer || !context)) {
		/**
		 * "unavailable" used to be the whole message, and it reads as an outage
		 * that will clear. On a forge with no signal surface at all it never
		 * clears, and a maintainer waits for something that is not coming.
		 */
		return skipped(
			record,
			forge
				? `Custom rules need data that ${forge} does not provide.`
				: "Tripwire could not read data from the forge.",
			now,
		);
	}
	try {
		const value =
			contextProducer && context
				? await contextProducer(
						createForgeSignalCtx({
							forge: context,
							event: context.event as Parameters<
								typeof createForgeSignalCtx
							>[0]["event"],
							now,
						}),
					)
				: producer && signalCtx
					? await producer(signalCtx)
					: undefined;
		const rule: SignalRule = {
			name: record.name,
			signal: record.definition.when as SignalRule["signal"],
			comparison: record.definition.comparison,
		};
		const { passed, resolvedValue } = evaluateSignalRule(rule, { value, now });
		if (
			passed &&
			context?.diff?.some((file) => file.patchUnavailable != null) &&
			record.definition.when.id === "pr.textByLocation"
		) {
			return skipped(
				record,
				"Tripwire could not read every patch in this change request.",
				now,
			);
		}
		return {
			ruleId: record.id,
			version: 1,
			status: "evaluated",
			passed,
			evidence: { observed: resolvedValue },
			evaluatedAt: now,
		};
	} catch (error) {
		if (
			error instanceof SignalUnavailableError ||
			error instanceof SignalEvaluationError
		) {
			return skipped(record, (error as Error).message, now);
		}
		throw error;
	}
}
