import { createContext, useContext } from "react";

/**
 * Live validation issues keyed by node id, provided by the editor shell and
 * read by node cards — context instead of node `data` so a validation pass
 * never has to churn `setNodes`.
 */
export const NodeIssuesContext = createContext<ReadonlyMap<string, string[]>>(
	new Map(),
);

export function useNodeIssues(nodeId: string): string[] {
	return useContext(NodeIssuesContext).get(nodeId) ?? [];
}
