import type { LiveNodeTouch } from "@tripwire/contracts";
import { createContext, useContext, useRef } from "react";
import { AgentOutline } from "#/components/agent/agent-outline";
import type { AgentMotion } from "#/hooks/use-agent-motion";

export interface AgentWorkState {
	touches: ReadonlyMap<string, LiveNodeTouch>;
	motion: AgentMotion;
}

const EMPTY: AgentWorkState = { touches: new Map(), motion: "full" };

export const AgentWorkContext = createContext<AgentWorkState>(EMPTY);

/** The dithered outline on a node an agent is working on; it fades when released. */
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
	return (
		<AgentOutline
			action={shown.action}
			active={Boolean(touch)}
			at={shown.at}
			motion={motion}
		/>
	);
}
