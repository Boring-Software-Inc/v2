import { describe, expect, test } from "bun:test";
import { pendingCheckIsStale, supersededBy } from "@tripwire/utils";
import { commentRows, toForgeAction } from "./pr-surface.ts";

describe("toForgeAction — request-review", () => {
	test("carries the recorded people and teams onto the forge action", () => {
		expect(
			toForgeAction(
				{
					kind: "request-review",
					payload: {
						nodeId: "w:review",
						reviewers: ["octocat"],
						teamReviewers: ["core"],
					},
				},
				"a/b",
				7,
				"stamp",
			),
		).toEqual({
			kind: "request-review",
			repoFullName: "a/b",
			number: 7,
			reviewers: ["octocat"],
			teamReviewers: ["core"],
		});
	});

	test("sends the logins of typed reviewers to GitHub", () => {
		expect(
			toForgeAction(
				{
					kind: "request-review",
					payload: {
						nodeId: "w:review",
						reviewers: [{ id: 583231, login: "octocat" }, "hubot"],
					},
				},
				"a/b",
				7,
				"stamp",
			),
		).toMatchObject({ reviewers: ["octocat", "hubot"], teamReviewers: [] });
	});

	test("a row recorded before targets existed maps to empty lists", () => {
		expect(
			toForgeAction(
				{ kind: "request-review", payload: { nodeId: "w:review" } },
				"a/b",
				7,
				"stamp",
			),
		).toMatchObject({ reviewers: [], teamReviewers: [] });
	});

	test("a malformed payload maps to empty lists, never a bad request", () => {
		expect(
			toForgeAction(
				{ kind: "request-review", payload: { reviewers: ["bad name"] } },
				"a/b",
				7,
				"stamp",
			),
		).toMatchObject({ reviewers: [], teamReviewers: [] });
	});
});

describe("toForgeAction: block posts once, then edits", () => {
	const row = { kind: "block", payload: { nodeId: "w:block" } };

	test("no live review: a new request-changes review", () => {
		expect(toForgeAction(row, "a/b", 7, "Blocked. See the comment.")).toEqual({
			kind: "block",
			repoFullName: "a/b",
			number: 7,
			reason: "Blocked. See the comment.",
		});
	});

	test("a live review: edit it instead of posting a second one", () => {
		expect(
			toForgeAction(row, "a/b", 7, "Blocked. See the comment.", "91"),
		).toEqual({
			kind: "update-review",
			repoFullName: "a/b",
			number: 7,
			reviewId: "91",
			reason: "Blocked. See the comment.",
		});
	});

	test("a workflow-authored reason wins over the default body", () => {
		expect(
			toForgeAction(
				{ kind: "block", payload: { reason: "A maintainer blocked it." } },
				"a/b",
				7,
				"Blocked. See the comment.",
				"91",
			),
		).toMatchObject({
			kind: "update-review",
			reason: "A maintainer blocked it.",
		});
	});

	test("other kinds ignore the live review", () => {
		expect(
			toForgeAction(
				{ kind: "dismiss-review", payload: { number: 7, reviewId: "91" } },
				"a/b",
				7,
				"stamp",
				"91",
			),
		).toMatchObject({ kind: "dismiss-review", reviewId: "91" });
	});
});

describe("commentRows: one row per comment plan", () => {
	const plan = (comment: "upsert" | "if-present" | "delete" | "none") => ({
		comment,
		commentBody: comment === "delete" || comment === "none" ? null : "body",
		review: null,
	});

	test("delete records a delete-comment row", () => {
		expect(commentRows(plan("delete"), 7, "block", null)).toEqual([
			{
				kind: "delete-comment",
				payload: { number: 7 },
				idempotencyKey: "delete-comment:7",
			},
		]);
	});

	test("if-present marks the comment so it never posts fresh", () => {
		const [row] = commentRows(plan("if-present"), 7, "pass", "block");
		expect(row?.payload).toMatchObject({ onlyIfPresent: true });
		expect(
			toForgeAction(row ?? { kind: "", payload: {} }, "a/b", 7, "x"),
		).toMatchObject({
			kind: "comment",
			onlyIfPresent: true,
			previousVerdict: "block",
		});
	});

	test("upsert posts as before, none posts nothing", () => {
		const [row] = commentRows(plan("upsert"), 7, "block", null);
		expect(row?.payload).not.toHaveProperty("onlyIfPresent");
		expect(commentRows(plan("none"), 7, "pass", null)).toEqual([]);
	});

	test("delete-comment maps to the forge action", () => {
		expect(
			toForgeAction(
				{ kind: "delete-comment", payload: { number: 7 } },
				"a/b",
				7,
				"x",
			),
		).toEqual({ kind: "delete-comment", repoFullName: "a/b", number: 7 });
	});

	test("a block row carries its own review body", () => {
		expect(
			toForgeAction(
				{ kind: "block", payload: { nodeId: "w:block", reason: "stored" } },
				"a/b",
				7,
				"fallback",
			),
		).toMatchObject({ kind: "block", reason: "stored" });
	});
});

describe("toForgeAction: lock and close never become a block", () => {
	test("lock carries its reason", () => {
		expect(
			toForgeAction(
				{ kind: "lock", payload: { reason: "spam", nodeId: "w:l" } },
				"a/b",
				7,
				"Blocked. See the comment.",
				"91",
			),
		).toEqual({ kind: "lock", repoFullName: "a/b", number: 7, reason: "spam" });
	});

	test("lock with no or a bad reason locks without one", () => {
		for (const payload of [{ nodeId: "w:l" }, { reason: "boring" }]) {
			expect(
				toForgeAction({ kind: "lock", payload }, "a/b", 7, "x", "91"),
			).toEqual({ kind: "lock", repoFullName: "a/b", number: 7 });
		}
	});

	test("close", () => {
		expect(
			toForgeAction({ kind: "close", payload: {} }, "a/b", 7, "x", "91"),
		).toEqual({ kind: "close", repoFullName: "a/b", number: 7 });
	});
});

describe("supersededBy — a stale run never overwrites a newer result", () => {
	const older = { id: "run-1", headSha: "sha-a" };
	const newerSameHead = { id: "run-2", headSha: "sha-a" };
	const newerOtherHead = { id: "run-3", headSha: "sha-b" };

	test("the latest run owns every surface", () => {
		for (const kind of ["comment", "block", "dismiss-review", "set-check"]) {
			expect(supersededBy(kind, older, older)).toBe(false);
			expect(supersededBy(kind, older, null)).toBe(false);
		}
	});

	test("a same-head re-run takes the check, comment and review", () => {
		for (const kind of [
			"set-check",
			"comment",
			"delete-comment",
			"block",
			"dismiss-review",
		]) {
			expect(supersededBy(kind, older, newerSameHead)).toBe(true);
		}
	});

	test("a newer head takes the comment and review, the old head keeps its check", () => {
		expect(supersededBy("comment", older, newerOtherHead)).toBe(true);
		expect(supersededBy("block", older, newerOtherHead)).toBe(true);
		expect(supersededBy("set-check", older, newerOtherHead)).toBe(false);
	});

	test("close, fix requests and notes belong to the latest run only", () => {
		for (const kind of ["close", "request-fix", "note"]) {
			expect(supersededBy(kind, older, older)).toBe(false);
			expect(supersededBy(kind, older, newerSameHead)).toBe(true);
			expect(supersededBy(kind, older, newerOtherHead)).toBe(true);
		}
	});

	test("workflow actions are not surfaces", () => {
		expect(supersededBy("label", older, newerSameHead)).toBe(false);
		expect(supersededBy("request-review", older, newerSameHead)).toBe(false);
	});
});

describe("pendingCheckIsStale", () => {
	const latest = {
		eventId: "01a17035-0000-7000-8000-000000000002",
		headSha: "sha-a",
	};

	test("an older event does not reopen a check a newer event settled", () => {
		expect(
			pendingCheckIsStale(
				latest,
				"01a17035-0000-7000-8000-000000000001",
				"sha-a",
			),
		).toBe(true);
	});

	test("the same or a newer event may hold the gate", () => {
		expect(pendingCheckIsStale(latest, latest.eventId, "sha-a")).toBe(false);
		expect(
			pendingCheckIsStale(
				latest,
				"01a17035-0000-7000-8000-000000000003",
				"sha-a",
			),
		).toBe(false);
		expect(pendingCheckIsStale(null, latest.eventId, "sha-a")).toBe(false);
	});

	test("a newer run on another head leaves this head alone", () => {
		expect(
			pendingCheckIsStale(
				latest,
				"01a17035-0000-7000-8000-000000000001",
				"sha-b",
			),
		).toBe(false);
	});
});
