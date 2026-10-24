import type { LiveNodeTouch } from "@tripwire/contracts";
import { createContext, useContext, useRef } from "react";
import { AgentDissolve } from "#/components/agent/agent-dissolve";
import { AgentOutline } from "#/components/agent/agent-outline";
import type { AgentMotion } from "#/hooks/use-agent-motion";

export interface AgentWorkState {
	touches: ReadonlyMap<string, LiveNodeTouch>;
	motion: AgentMotion;
}

const EMPTY: AgentWorkState = { touches: new Map(), motion: "full" };

export const AgentWorkContext = createContext<AgentWorkState>(EMPTY);

/** The agent outline on a node an agent is working on; it fades when released. */
export function NodeAgentOutline({ nodeId }: { nodeId: string }) {
	const { touches, motion } = useContext(AgentWorkContext);
	const touch = touches.get(nodeId);
	const last = useRef(touch);
	if (touch) {
		last.current = touch;
	}
	const shown = last.current;
	if (!shown) {
		return null;
	}
	return <AgentOutline active={Boolean(touch)} motion={motion} seed={nodeId} />;
}

export const AgentEnterContext = createContext<ReadonlyMap<string, number>>(
	new Map(),
);

export function NodeEnterDissolve({ nodeId }: { nodeId: string }) {
	const delay = useContext(AgentEnterContext).get(nodeId);
	return delay === undefined ? null : <AgentDissolve delay={delay} />;
}
