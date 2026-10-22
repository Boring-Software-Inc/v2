import { z } from "zod";
import type { CommentReason } from "./comment-render.ts";
import { type RedactionItem, redactionHides } from "./redaction.ts";
import {
	ruleCatalogEntry,
	ruleContributorLabel,
	ruleDisplayName,
} from "./rules.ts";
import { type JsonValue, jsonValueSchema } from "./workflow.ts";

export type RedactedReasons =
	| { kind: "reasons"; reasons: CommentReason[] }
	| { kind: "names"; names: string[] }
	| { kind: "count"; count: number }
	| { kind: "verdict" };

function catalogField<K extends "summaryReveals" | "evidenceRedaction">(
	ref: string,
	key: K,
) {
	const entry = ruleCatalogEntry(ref) as {
		summaryReveals?: readonly RedactionItem[];
		evidenceRedaction?: Partial<Record<RedactionItem, readonly string[]>>;
	} | null;
	return entry?.[key];
}

export function summaryRevealsHidden(ref: string, level: number): boolean {
	if (redactionHides(level, "reasons")) {
		return true;
	}
	return (catalogField(ref, "summaryReveals") ?? []).some((item) =>
		redactionHides(level, item),
	);
}

export const UNNAMED_RULE = "Unnamed rule";

export function reasonName(reason: CommentReason): string {
	const name =
		reason.ruleName?.trim() ||
		(reason.ruleId ? ruleDisplayName(reason.ruleId) : "");
	return name === "" ? UNNAMED_RULE : name;
}

function capitalize(text: string): string {
	const trimmed = text.trim();
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function redactSummary(
	ref: string | null,
	summary: string | null,
	level: number,
): string | null {
	if (summary === null || ref === null) {
		return summary;
	}
	if (redactionHides(level, "reasons")) {
		return null;
	}
	if (!summaryRevealsHidden(ref, level)) {
		return summary;
	}
	const label = ruleContributorLabel(ref);
	return label ? capitalize(label) : null;
}

export function redactCommentReasons(
	reasons: CommentReason[],
	level: number,
): RedactedReasons {
	if (redactionHides(level, "failed-count")) {
		return { kind: "verdict" };
	}
	if (redactionHides(level, "rule-names")) {
		return { kind: "count", count: reasons.length };
	}
	if (redactionHides(level, "reasons")) {
		return {
			kind: "names",
			names: reasons.map(reasonName),
		};
	}
	return {
		kind: "reasons",
		reasons: reasons.map((reason) => {
			if (!reason.ruleId || !summaryRevealsHidden(reason.ruleId, level)) {
				return reason;
			}
			const label = ruleContributorLabel(reason.ruleId);
			return label ? { ...reason, text: label, hint: null } : reason;
		}),
	};
}

const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

function deletePath(value: JsonValue, path: readonly string[]): JsonValue {
	const [head, ...rest] = path;
	if (head === undefined) {
		return value;
	}
	if (Array.isArray(value)) {
		return head === "*" ? value.map((item) => deletePath(item, rest)) : value;
	}
	const record = jsonRecordSchema.safeParse(value);
	if (!record.success || !(head in record.data)) {
		return value;
	}
	const { [head]: target, ...kept } = record.data;
	return rest.length === 0
		? kept
		: { ...kept, [head]: deletePath(target ?? null, rest) };
}

export function redactEvidence(
	ref: string | null,
	evidence: JsonValue,
	level: number,
): JsonValue {
	if (redactionHides(level, "ai-trace")) {
		return null;
	}
	if (ref === null || evidence === null) {
		return evidence;
	}
	const fields = catalogField(ref, "evidenceRedaction") ?? {};
	let redacted: JsonValue = evidence;
	for (const [item, paths] of Object.entries(fields) as [
		RedactionItem,
		readonly string[],
	][]) {
		if (!redactionHides(level, item)) {
			continue;
		}
		for (const path of paths) {
			redacted = deletePath(redacted, path.split("."));
		}
	}
	return redacted;
}
