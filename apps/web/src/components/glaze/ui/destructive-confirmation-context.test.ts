import { describe, expect, test } from "bun:test";
import { resolveDestructiveConfirmation } from "./destructive-confirmation-context";

describe("resolveDestructiveConfirmation", () => {
	test("derives a safe confirmation from the button label", () => {
		expect(resolveDestructiveConfirmation("Delete", undefined)).toEqual({
			actionLabel: "Delete",
			confirmText: undefined,
			description:
				"This action can affect saved data or access. Confirm before continuing.",
			media: undefined,
			pendingLabel: "Working",
			title: "Delete?",
		});
	});

	test("keeps action-specific confirmation copy", () => {
		expect(
			resolveDestructiveConfirmation("Remove", {
				actionLabel: "Disconnect",
				confirmText: "agent-1",
				description: "The agent will lose access.",
				pendingLabel: "Disconnecting",
				title: "Disconnect agent-1?",
			}),
		).toEqual({
			actionLabel: "Disconnect",
			confirmText: "agent-1",
			description: "The agent will lose access.",
			media: undefined,
			pendingLabel: "Disconnecting",
			title: "Disconnect agent-1?",
		});
	});
});
