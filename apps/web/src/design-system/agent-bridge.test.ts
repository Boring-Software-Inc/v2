import { describe, expect, test } from "bun:test";
import type { TripwireAgentAction } from "@tripwire/ui/agent-runtime";
import {
	type ConfirmAgentAction,
	createTripwireAgentPermission,
	isStructurallyAllowedAgentAction,
} from "#/design-system/agent-bridge";

function action(
	overrides: Partial<TripwireAgentAction> = {},
): TripwireAgentAction {
	return {
		action: "press",
		args: [],
		component: "button",
		ref: "c1",
		...overrides,
	};
}

describe("Tripwire browser agent policy", () => {
	test("allows value changes on both slider primitives", () => {
		for (const component of ["slider", "step-slider"]) {
			expect(
				isStructurallyAllowedAgentAction(
					action({ component, action: "setValue", args: [7] }),
				),
			).toBe(true);
			expect(isStructurallyAllowedAgentAction(action({ component }))).toBe(
				false,
			);
		}
	});
	test("allows known component actions and denies unknown actions", () => {
		expect(isStructurallyAllowedAgentAction(action())).toBe(true);
		expect(
			isStructurallyAllowedAgentAction(
				action({ action: "setValue", component: "field" }),
			),
		).toBe(true);
		expect(
			isStructurallyAllowedAgentAction(
				action({ action: "launch", component: "unknown-widget" }),
			),
		).toBe(false);
	});

	test("lets the product agent toggle Combobox visibility without editing", async () => {
		const confirm: ConfirmAgentAction = async () => {
			throw new Error("Combobox actions must never request confirmation");
		};
		const allow = createTripwireAgentPermission(confirm);
		const context = { signal: new AbortController().signal };
		for (const open of [true, false]) {
			expect(
				await allow(
					action({ component: "combobox", action: "setOpen", args: [open] }),
					context,
				),
			).toBe(true);
		}
		for (const name of ["setQuery", "setValue", "clear"]) {
			const step = action({ component: "combobox", action: name });
			expect(await allow(step, context)).toBe(false);
			expect(
				await allow({ ...step, confirm: "Change timezone" }, context),
			).toBe(false);
		}
	});

	test("allows UI-only navigation actions", () => {
		expect(
			isStructurallyAllowedAgentAction(
				action({ action: "setValue", component: "tabs" }),
			),
		).toBe(true);
		expect(
			isStructurallyAllowedAgentAction(
				action({ action: "close", component: "dialog" }),
			),
		).toBe(true);
	});

	test("requires approval before pressing a confirmed command", async () => {
		const summary = "Sign out of Tripwire?";
		const step = action({
			component: "command",
			confirm: summary,
		});
		const signal = new AbortController().signal;
		const rejected = createTripwireAgentPermission(
			async (receivedSummary, receivedSignal) => {
				expect(receivedSummary).toBe(summary);
				expect(receivedSignal).toBe(signal);
				return false;
			},
		);
		const approved = createTripwireAgentPermission(async () => true);
		expect(await rejected(step, { signal })).toBe(false);
		expect(await approved(step, { signal })).toBe(true);
		expect(await rejected(action({ component: "command" }), { signal })).toBe(
			true,
		);
	});

	test("requires a non-empty confirmation summary for other actions", () => {
		expect(
			isStructurallyAllowedAgentAction(action({ confirm: "Delete workspace" })),
		).toBe(true);
		expect(isStructurallyAllowedAgentAction(action({ confirm: "  " }))).toBe(
			false,
		);
		expect(
			isStructurallyAllowedAgentAction(
				action({
					action: "launch",
					component: "unknown-widget",
					confirm: "Do an unknown thing",
				}),
			),
		).toBe(false);
	});

	test("confirmation adapters receive the abort signal", async () => {
		const controller = new AbortController();
		const confirm: ConfirmAgentAction = async (summary, signal) => {
			expect(summary).toBe("Save settings");
			expect(signal).toBe(controller.signal);
			return !signal.aborted;
		};

		expect(await confirm("Save settings", controller.signal)).toBe(true);
		controller.abort();
		expect(await confirm("Save settings", controller.signal)).toBe(false);
	});
});
