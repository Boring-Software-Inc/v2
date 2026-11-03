import { describe, expect, test } from "bun:test";
import {
	type CustomRuleDefinition,
	type CustomSignalDisplay,
	customSignalDisplay,
} from "@tripwire/contracts";
import {
	type BuilderState,
	draftFromState,
	nextStep,
	valueIssue,
} from "./custom-rule-builder.tsx";

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
		).toBe("Enter a number.");
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
		).toBe("Enter a percentage from 0 to 100.");
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
		).toBe("Enter a low and a high number.");
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

describe("draftFromState", () => {
	test("scalar and list comparisons keep their exact serialized output", () => {
		const cases = [
			{
				id: "contributor.accountAge",
				verb: "under",
				fields: { value: " 7 " },
				args: [7],
			},
			{
				id: "contributor.accountAge",
				verb: "between",
				fields: { value: "2", high: "10" },
				args: [2, 10],
			},
			{
				id: "pr.sourceBranch",
				verb: "startsWith",
				fields: { value: " release- " },
				args: ["release-"],
			},
			{
				id: "pr.targetBranch",
				verb: "endsWith",
				fields: { value: " -stable " },
				args: ["-stable"],
			},
			{
				id: "pr.body",
				verb: "containsAny",
				fields: { values: ["first", "second"] },
				args: [["first", "second"]],
			},
			{
				id: "pr.changedPaths",
				verb: "noneMatch",
				fields: { values: ["src/**"] },
				args: [["src/**"]],
			},
		] satisfies {
			id: string;
			verb: CustomRuleDefinition["comparison"]["kind"];
			fields: Parameters<typeof state>[2];
			args: CustomRuleDefinition["comparison"]["args"];
		}[];
		for (const entry of cases) {
			const draft = draftFromState({
				...state(entry.id, entry.verb, entry.fields),
				name: "  My rule  ",
			});
			expect(draft).toEqual({
				name: "My rule",
				definition: {
					when: { id: entry.id },
					comparison: { kind: entry.verb, args: entry.args },
				},
			});
			expect(draft?.definition.when).not.toHaveProperty("transform");
		}
	});

	test("boolean presence and absence retain the nested comparison shape", () => {
		expect(
			draftFromState({
				...state("contributor.hireable", "equals"),
				name: "Present",
			})?.definition.comparison,
		).toEqual({ kind: "equals", args: [true] });
		expect(
			draftFromState({
				...state("contributor.hireable", "not"),
				name: "Absent",
			})?.definition.comparison,
		).toEqual({ kind: "not", args: [{ kind: "equals", args: [true] }] });
	});

	test("only timestamp signals emit the lastCount transform", () => {
		const timestampState = {
			...state("contributor.recentForkTimes", "atMost", { value: "3" }),
			name: "Fork rate",
		};
		expect(draftFromState(timestampState)).toBeNull();
		expect(draftFromState({ ...timestampState, window: "7d" })).toEqual({
			name: "Fork rate",
			definition: {
				when: {
					id: "contributor.recentForkTimes",
					transform: { kind: "lastCount", window: "7d" },
				},
				comparison: { kind: "atMost", args: [3] },
			},
		});
		const scalarDraft = draftFromState({
			...state("contributor.accountAge", "under", { value: "3" }),
			window: "7d",
			name: "Account age",
		});
		expect(scalarDraft?.definition.when).toEqual({
			id: "contributor.accountAge",
		});
	});

	test("invalid and incomplete state is not mutated or emitted", () => {
		const incomplete = state("pr.title", "has");
		expect(draftFromState(incomplete)).toBeNull();
		const invalid = {
			...state("contributor.accountAge", "under", { value: "abc" }),
			name: "Invalid",
		};
		expect(draftFromState(invalid)).toBeNull();
		expect(invalid.value).toBe("abc");
		expect(nextStep(invalid)).toBe("Enter a number.");
		expect(
			draftFromState({ ...state("pr.body", "containsAny"), name: "No chips" }),
		).toBeNull();
		expect(
			draftFromState({
				...state("pr.title", "has", { value: "title" }),
				name: "  ",
			}),
		).toBeNull();
	});

	test("the existing empty-number conversion and percentage units are unchanged", () => {
		expect(
			draftFromState({
				...state("contributor.accountAge", "under"),
				name: "Zero",
			})?.definition.comparison,
		).toEqual({ kind: "under", args: [0] });
		expect(
			draftFromState({
				...state("contributor.mergeRatioGlobal", "under", { value: "30" }),
				name: "Ratio",
			})?.definition.comparison,
		).toEqual({ kind: "under", args: [30] });
	});
});

describe("branch prefix and suffix", () => {
	test("a source branch that starts with a prefix only waits for a name", () => {
		expect(
			nextStep(
				state("pr.sourceBranch", "startsWith", { value: "release-please" }),
			),
		).toBe("Name the rule to save it.");
	});

	test("ends with on a target branch needs a value first", () => {
		expect(nextStep(state("pr.targetBranch", "endsWith"))).toBe(
			"Enter a value.",
		);
	});
});
