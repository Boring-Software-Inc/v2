import {
	type CustomRuleRecord,
	customRuleRecordSchema,
	customRuleRef,
	type RuleResult,
} from "@tripwire/contracts";
import { type GithubHttp, githubForge } from "@tripwire/forge-github";
import {
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
): Promise<RuleResult> {
	const producers: Record<string, (ctx: CustomSignalCtx) => unknown> =
		githubForge.produces;
	const producer = producers[record.definition.when.id];
	if (!producer) {
		return skipped(
			record,
			`signal ${record.definition.when.id} is not available on this forge`,
			now,
		);
	}
	if (!signalCtx) {
		return skipped(record, "forge reads unavailable", now);
	}
	try {
		const value = await producer(signalCtx);
		const rule: SignalRule = {
			name: record.name,
			signal: record.definition.when as SignalRule["signal"],
			comparison: record.definition.comparison,
			severity: record.definition.severity,
		};
		const { passed, resolvedValue } = evaluateSignalRule(rule, { value, now });
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
