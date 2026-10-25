import type { JsonValue, WorkflowNode } from "@tripwire/contracts";
import { createContext, useContext } from "react";
import type { RuleGroupsView, SkipMode } from "#/lib/rule-groups";

export interface RuleChoice {
	ref: string;
	name: string;
	config: JsonValue;
}

export interface RuleGroupsApi {
	view: RuleGroupsView;
	nodes: ReadonlyMap<string, WorkflowNode>;
	choices: readonly RuleChoice[];
	readOnly: boolean;
	addRule: (cardId: string, choice: RuleChoice) => void;
	removeRule: (cardId: string, ruleId: string) => void;
	addCheck: (cardId: string, choice: RuleChoice) => void;
	removeCheck: (cardId: string, ruleId: string) => void;
	setMode: (cardId: string, mode: SkipMode) => void;
	attachSkip: (cardId: string) => void;
	removeSkip: (cardId: string) => void;
	select: (nodeId: string) => void;
}

const EMPTY: RuleGroupsApi = {
	view: {
		cards: new Map(),
		memberOf: new Map(),
		hiddenEdges: new Set(),
		viewEdges: [],
	},
	nodes: new Map(),
	choices: [],
	readOnly: true,
	addRule: () => undefined,
	removeRule: () => undefined,
	addCheck: () => undefined,
	removeCheck: () => undefined,
	setMode: () => undefined,
	attachSkip: () => undefined,
	removeSkip: () => undefined,
	select: () => undefined,
};

export const RuleGroupsContext = createContext<RuleGroupsApi>(EMPTY);

export function useRuleGroups(): RuleGroupsApi {
	return useContext(RuleGroupsContext);
}
