import {
	createTripwireAgent,
	registerTripwireAgentTools,
	type TripwireAgentAction,
} from "@tripwire/ui/agent-runtime";

const SAFE_AGENT_ACTIONS = new Map<string, ReadonlySet<string>>([
	["accordion", new Set(["collapse", "expand", "setValue", "toggle"])],
	["button", new Set(["press"])],
	["carousel", new Set(["first", "last", "next", "previous", "setPage"])],
	["checkbox", new Set(["setChecked", "toggle"])],
	["checkbox-group", new Set(["setAll", "setValue"])],
	["combobox", new Set(["setOpen"])],
	["command", new Set(["press"])],
	["dialog", new Set(["close", "setOpen"])],
	["drawer", new Set(["close", "setOpen"])],
	["field", new Set(["setValue"])],
	["menu", new Set(["close", "open", "press", "select", "setOpen"])],
	["navigation-menu", new Set(["close", "open", "setOpen"])],
	["popover", new Set(["close", "open", "setOpen"])],
	["select", new Set(["select", "setValue"])],
	["slider", new Set(["setValue"])],
	["step-slider", new Set(["setValue"])],
	["switch", new Set(["setChecked", "toggle"])],
	["tabs", new Set(["select", "setValue"])],
	["toggle", new Set(["setPressed", "toggle"])],
	["tooltip", new Set(["close", "open", "setOpen"])],
]);

const CONFIRMABLE_AGENT_ACTIONS = new Map<string, ReadonlySet<string>>([
	["button", new Set(["press"])],
	["checkbox", new Set(["setChecked", "toggle"])],
	["checkbox-group", new Set(["setAll", "setValue"])],
	["command", new Set(["press"])],
	["field", new Set(["setValue"])],
	["menu", new Set(["press", "select"])],
	["select", new Set(["select", "setValue"])],
	["switch", new Set(["setChecked", "toggle"])],
	["toggle", new Set(["setPressed", "toggle"])],
]);

export type ConfirmAgentAction = (
	summary: string,
	signal: AbortSignal,
) => Promise<boolean>;

export function isStructurallyAllowedAgentAction(
	step: TripwireAgentAction,
): boolean {
	if (step.confirm !== undefined) {
		if (!step.confirm.trim()) return false;
		return (
			CONFIRMABLE_AGENT_ACTIONS.get(step.component)?.has(step.action) ?? false
		);
	}
	return SAFE_AGENT_ACTIONS.get(step.component)?.has(step.action) ?? false;
}

export function registerTripwireBrowserAgent(
	confirmAction: ConfirmAgentAction,
): () => void {
	const agent = createTripwireAgent({
		allow: (step) => isStructurallyAllowedAgentAction(step),
		timeout: 120_000,
	});

	return registerTripwireAgentTools(
		agent,
		createTripwireAgentPermission(confirmAction),
	);
}

export function createTripwireAgentPermission(
	confirmAction: ConfirmAgentAction,
) {
	return async (
		step: TripwireAgentAction,
		{ signal }: { signal: AbortSignal },
	) => {
		if (!isStructurallyAllowedAgentAction(step)) return false;
		const summary = step.confirm?.trim();
		return summary ? confirmAction(summary, signal) : true;
	};
}
