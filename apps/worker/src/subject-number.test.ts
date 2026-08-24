import { describe, expect, test } from "bun:test";

/**
 * `runs.subject_number` derivation, pinned.
 *
 * A comment names its change request in `comment.subjectNumber`. Reading it only
 * from a change-request event stored null for every comment-triggered run, and
 * `sweep-actions` SKIPS actions whose subject is null — so a recorded block or
 * comment was never delivered, then abandoned by the give-up window.
 */
function subjectNumberOf(event: {
	changeRequest?: { number: number };
	comment?: { subjectNumber: number };
}): number | null {
	return "changeRequest" in event && event.changeRequest
		? event.changeRequest.number
		: "comment" in event && event.comment
			? event.comment.subjectNumber
			: null;
}

describe("run subject number", () => {
	test("a change request names itself", () => {
		expect(subjectNumberOf({ changeRequest: { number: 12 } })).toBe(12);
	});

	test("a comment names the change request it sits on", () => {
		expect(subjectNumberOf({ comment: { subjectNumber: 34 } })).toBe(34);
	});

	test("an event with neither has no subject", () => {
		expect(subjectNumberOf({})).toBeNull();
	});

	test("a change request wins when somehow both are present", () => {
		expect(
			subjectNumberOf({
				changeRequest: { number: 1 },
				comment: { subjectNumber: 2 },
			}),
		).toBe(1);
	});
});
