import { describe, expect, test } from "bun:test";
import {
	type CustomSignalDisplay,
	customSignalDisplay,
} from "@tripwire/contracts";
import { type BuilderState, valueIssue } from "./custom-rule-builder.tsx";

/**
 * The client-side "why is Save disabled" message. The server re-validates via
 * storedRuleIssue; this is the same judgment surfaced to the maintainer before
 * they submit, so an invalid value never sits as a dead button with no reason.
 */

function signal(id: string): CustomSignalDisplay {
	const display = customSignalDisplay(id);
	if (!display) {
		throw new Error(`no display for ${id}`);
	}
	return display;
}

function state(
	id: string,
	verbKind: string,
	fields: { value?: string; high?: string; values?: string[] } = {},
): BuilderState {
	return {
		area: null,
		signal: signal(id),
		window: null,
		verb: { kind: verbKind, label: verbKind },
		value: fields.value ?? "",
		high: fields.high ?? "",
		values: fields.values ?? [],
		severity: null,
		name: "",
	};
}

describe("valueIssue", () => {
	test("empty is incomplete, not invalid: no message", () => {
		expect(valueIssue(state("contributor.accountAge", "under"))).toBeNull();
	});

	test("text in a number field is named", () => {
		expect(
			valueIssue(state("contributor.accountAge", "under", { value: "abc" })),
		).toBe("enter a number");
	});

	test("a valid number passes", () => {
		expect(
			valueIssue(state("contributor.accountAge", "under", { value: "7" })),
		).toBeNull();
	});

	test("percent signals want 0 to 100", () => {
		expect(
			valueIssue(
				state("contributor.mergeRatioGlobal", "under", { value: "150" }),
			),
		).toBe("enter a percentage from 0 to 100");
		expect(
			valueIssue(
				state("contributor.mergeRatioGlobal", "under", { value: "30" }),
			),
		).toBeNull();
	});

	test("between needs both ends numeric, and stays quiet until both are typed", () => {
		expect(
			valueIssue(state("contributor.accountAge", "between", { value: "2" })),
		).toBeNull();
		expect(
			valueIssue(
				state("contributor.accountAge", "between", { value: "2", high: "abc" }),
			),
		).toBe("enter a low and a high number");
		expect(
			valueIssue(
				state("contributor.accountAge", "between", { value: "2", high: "10" }),
			),
		).toBeNull();
	});

	test("list verbs use chips, so they carry no message", () => {
		expect(
			valueIssue(state("pr.body", "containsAny", { values: [] })),
		).toBeNull();
		expect(
			valueIssue(state("pr.body", "containsAny", { values: ["airdrop"] })),
		).toBeNull();
	});

	test("free text accepts any non-empty value", () => {
		expect(
			valueIssue(state("pr.title", "has", { value: "anything" })),
		).toBeNull();
	});

	test("boolean signals take no value", () => {
		expect(valueIssue(state("contributor.hireable", "equals"))).toBeNull();
	});
});
