import type { LintFix, LintSeverity } from "@tripwire/contracts";
import { createContext, useContext } from "react";

export interface Problem {
	key: string;
	rule: string | null;
	severity: LintSeverity;
	step: string;
	message: string;
	nodeId?: string;
	edgeId?: string;
	fixes: LintFix[];
}

export interface ProblemsApi {
	byNode: ReadonlyMap<string, Problem[]>;
	byEdge: ReadonlyMap<string, Problem[]>;
	onFix: (problem: Problem, fix: LintFix) => void;
	onReveal: (problem: Problem) => void;
}

const NONE: Problem[] = [];

export const ProblemsContext = createContext<ProblemsApi>({
	byNode: new Map(),
	byEdge: new Map(),
	onFix: () => undefined,
	onReveal: () => undefined,
});

export function useProblems(): ProblemsApi {
	return useContext(ProblemsContext);
}

export function useNodeProblems(nodeId: string): Problem[] {
	return useContext(ProblemsContext).byNode.get(nodeId) ?? NONE;
}

export function useEdgeProblems(edgeId: string): Problem[] {
	return useContext(ProblemsContext).byEdge.get(edgeId) ?? NONE;
}

export function groupProblems(
	problems: readonly Problem[],
	key: "nodeId" | "edgeId",
): Map<string, Problem[]> {
	const map = new Map<string, Problem[]>();
	for (const problem of problems) {
		const id = problem[key];
		if (id) {
			map.set(id, [...(map.get(id) ?? []), problem]);
		}
	}
	return map;
}

export function problemCount(problems: readonly Problem[]): string {
	const errors = problems.filter((p) => p.severity === "error").length;
	if (errors > 0) {
		return `${errors} to fix`;
	}
	const suggestions = problems.length;
	return `${suggestions} ${suggestions === 1 ? "suggestion" : "suggestions"}`;
}

export interface ProblemSection {
	key: "fix" | "suggest";
	title: string;
	problems: Problem[];
}

export function problemSections(
	problems: readonly Problem[],
): ProblemSection[] {
	const fix = problems.filter((p) => p.severity === "error");
	const suggest = problems.filter((p) => p.severity !== "error");
	return [
		{ key: "fix" as const, title: "Fix these to turn it on", problems: fix },
		{ key: "suggest" as const, title: "Suggestions", problems: suggest },
	].filter((section) => section.problems.length > 0);
}

export const CustomRuleNamesContext = createContext<
	ReadonlyMap<string, string>
>(new Map());

export function useCustomRuleName(ref: string): string | null {
	return useContext(CustomRuleNamesContext).get(ref) ?? null;
}

export const EditFieldContext = createContext<
	(nodeId: string, fieldKey: string) => void
>(() => undefined);

export function useEditField(): (nodeId: string, fieldKey: string) => void {
	return useContext(EditFieldContext);
}

export interface CronDraftsApi {
	drafts: ReadonlyMap<string, string>;
	setDraft: (nodeId: string, text: string | null) => void;
}

export const CronDraftsContext = createContext<CronDraftsApi>({
	drafts: new Map(),
	setDraft: () => undefined,
});

export function useCronDraft(nodeId: string): {
	draft: string | undefined;
	setDraft: (text: string | null) => void;
} {
	const api = useContext(CronDraftsContext);
	return {
		draft: api.drafts.get(nodeId),
		setDraft: (text) => api.setDraft(nodeId, text),
	};
}
