import type { LintFix, LintSeverity } from "@tripwire/contracts";
import { createContext, useContext } from "react";

export interface Problem {
	key: string;
	rule: string | null;
	severity: LintSeverity;
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
	const warnings = problems.length - errors;
	const parts = [
		errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"}` : null,
		warnings > 0
			? `${warnings} ${warnings === 1 ? "warning" : "warnings"}`
			: null,
	];
	return parts.filter((part) => part !== null).join(", ");
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
