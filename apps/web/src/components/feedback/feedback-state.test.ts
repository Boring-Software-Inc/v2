import { describe, expect, test } from "bun:test";
import {
	type FeedbackAction,
	type FeedbackState,
	feedbackReducer,
	initialFeedbackState,
} from "./feedback-state";

type Picked = { name: string };

function run(
	actions: FeedbackAction<Picked>[],
	from: FeedbackState<Picked> = initialFeedbackState<Picked>(),
): FeedbackState<Picked> {
	return actions.reduce(feedbackReducer<Picked>, from);
}

describe("feedbackReducer", () => {
	test("start, pick, type, then a matching finish closes and clears", () => {
		const open = run([
			{ type: "start" },
			{ type: "pick", picked: { name: "RuleCard" } },
			{ type: "draft", value: "flags our docs" },
		]);
		expect(open.phase).toBe("open");
		expect(open.session).toBe(1);
		const done = feedbackReducer(open, { type: "finish", session: 1 });
		expect(done).toMatchObject({ phase: "closed", picked: null, draft: "" });
	});

	test("an earlier send finishing never closes a newer session", () => {
		const first = run([
			{ type: "start" },
			{ type: "pick", picked: { name: "RuleCard" } },
			{ type: "draft", value: "first" },
		]);
		const sentFrom = first.session;
		const second = run(
			[
				{ type: "start" },
				{ type: "pick", picked: { name: "ShellNav" } },
				{ type: "draft", value: "second, not sent yet" },
			],
			first,
		);
		const after = feedbackReducer(second, {
			type: "finish",
			session: sentFrom,
		});
		expect(after).toBe(second);
		expect(after.draft).toBe("second, not sent yet");
		expect(after.picked).toEqual({ name: "ShellNav" });
	});

	test("pick again keeps the draft and Esc returns to the panel", () => {
		const state = run([
			{ type: "start" },
			{ type: "pick", picked: { name: "RuleCard" } },
			{ type: "draft", value: "keep me" },
			{ type: "pick-again" },
			{ type: "cancel-picking" },
		]);
		expect(state).toMatchObject({
			phase: "open",
			draft: "keep me",
			picked: { name: "RuleCard" },
		});
	});

	test("Esc on a fresh pick closes", () => {
		const state = run([{ type: "start" }, { type: "cancel-picking" }]);
		expect(state.phase).toBe("closed");
	});

	test("skip opens the panel with no element", () => {
		const state = run([{ type: "start" }, { type: "pick", picked: null }]);
		expect(state).toMatchObject({ phase: "open", picked: null });
	});
});
