import {
	type AgentAction,
	type AgentChange,
	type AgentComponent,
	type AgentStep,
	createAgent,
	registerTools,
} from "@ui-sdk/core/agent";

export type TripwireAgent = ReturnType<typeof createAgent>;
export type TripwireAgentAction = AgentAction;
export type TripwireAgentChange = AgentChange;
export type TripwireAgentComponent = AgentComponent;
export type TripwireAgentStep = AgentStep;

export interface TripwireAgentPermissionContext {
	signal: AbortSignal;
}

export type TripwireAgentPermission = (
	action: TripwireAgentAction,
	context: TripwireAgentPermissionContext,
) => boolean | Promise<boolean>;

export interface CreateTripwireAgentOptions {
	allow?: TripwireAgentPermission;
	timeout?: number;
}

export function createTripwireAgent(options?: CreateTripwireAgentOptions) {
	return createAgent(options);
}

export function registerTripwireAgentTools(
	agent: TripwireAgent,
	allow: TripwireAgentPermission,
) {
	return registerTools(agent, { allow });
}
