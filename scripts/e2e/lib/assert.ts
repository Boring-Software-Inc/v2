/**
 * Assertions as DATA, not throw-and-die. A scenario's `assert` fn records each
 * expectation against REAL GitHub state; the runner renders a per-assertion
 * ✓/✗ diff and the process exit code follows `passed`. This is what makes the
 * harness a gate (exit non-zero on any failure) and its output a readable diff.
 */

import {
	jsonSerializationSchema,
	thrownStringSchema,
} from "@tripwire/contracts";

export interface AssertionResult {
	label: string;
	expected: string;
	actual: string;
	ok: boolean;
}

function show(
	value: Parameters<typeof jsonSerializationSchema.parse>[0],
): string {
	const text = thrownStringSchema.safeParse(value);
	return text.success ? text.data : jsonSerializationSchema.parse(value);
}

export class Asserter {
	readonly results: AssertionResult[] = [];

	/** Record an equality check; returns whether it held (for early branching). */
	equals(
		label: string,
		expected: Parameters<typeof show>[0],
		actual: Parameters<typeof show>[0],
	): boolean {
		const ok = show(expected) === show(actual);
		this.results.push({
			label,
			expected: show(expected),
			actual: show(actual),
			ok,
		});
		return ok;
	}

	/** Record a boolean expectation with a human description of the truth. */
	ok(label: string, actual: boolean, detail?: string): boolean {
		this.results.push({
			label,
			expected: "true",
			actual: actual ? "true" : (detail ?? "false"),
			ok: actual,
		});
		return actual;
	}

	/** Record that `haystack` contains `needle`. */
	includes(label: string, haystack: string, needle: string): boolean {
		const ok = haystack.includes(needle);
		this.results.push({
			label,
			expected: `contains "${needle}"`,
			actual: ok ? "present" : "absent",
			ok,
		});
		return ok;
	}

	get passed(): boolean {
		return this.results.every((r) => r.ok);
	}

	get failures(): AssertionResult[] {
		return this.results.filter((r) => !r.ok);
	}
}
