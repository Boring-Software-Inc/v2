import { type ReactNode, useEffect } from "react";
import { registerTripwireBrowserAgent } from "#/design-system/agent-bridge";
import { useAgentConfirmation } from "#/design-system/agent-confirmation";

export function AgentBridgeProvider({ children }: { children: ReactNode }) {
	const confirmAction = useAgentConfirmation();

	useEffect(() => registerTripwireBrowserAgent(confirmAction), [confirmAction]);

	return children;
}
