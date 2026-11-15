import type { ReactNode } from "react";

export type AgentVisibility = "visible" | "hidden";
export type AgentExposure = "public" | "secret";

export interface AgentBoundaryProps {
	children: ReactNode;
	visibility?: AgentVisibility;
	exposure?: AgentExposure;
	confirmation?: string;
}

export const AGENT_CHANGE_SOURCE = "agent" as const;

export function AgentBoundary({
	children,
	visibility = "visible",
	exposure = "public",
	confirmation,
}: AgentBoundaryProps) {
	return (
		<div
			data-agent-confirm={confirmation}
			data-agent-hidden={visibility === "hidden" ? "" : undefined}
			data-agent-secret={exposure === "secret" ? "" : undefined}
			data-slot="agent-boundary"
		>
			{children}
		</div>
	);
}
