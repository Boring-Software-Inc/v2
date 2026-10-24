import { describe, expect, test } from "bun:test";
import {
	effectivePushStatus,
	pushBlockingIssues,
	pushExitCode,
	WORKFLOW_PUSH_STATUSES,
	workflowPushEntriesSchema,
	workflowPushViewSchema,
} from "./workflow-push.ts";

const NOW = new Date("2026-10-24T12:00:00Z");
const LATER = new Date("2026-10-24T13:00:00Z");
const EARLIER = new Date("2026-10-24T11:00:00Z");

describe("effectivePushStatus", () => {
	test("a pending push inside its hour stays pending", () => {
		expect(
			effectivePushStatus({
				status: "pending",
				expiresAt: LATER,
				now: NOW,
				drifted: false,
			}),
		).toBe("pending");
	});

	test("a pending push past its hour reads as expired", () => {
		expect(
			effectivePushStatus({
				status: "pending",
				expiresAt: EARLIER,
				now: NOW,
				drifted: false,
			}),
		).toBe("expired");
	});

	test("expiry wins over drift", () => {
		expect(
			effectivePushStatus({
				status: "pending",
				expiresAt: NOW,
				now: NOW,
				drifted: true,
			}),
		).toBe("expired");
	});

	test("a pending push whose base moved reads as stale", () => {
		expect(
			effectivePushStatus({
				status: "pending",
				expiresAt: LATER,
				now: NOW,
				drifted: true,
			}),
		).toBe("stale");
	});

	test("a decided push keeps its status", () => {
		for (const status of [
			"accepted",
			"rejected",
			"expired",
			"stale",
		] as const) {
			expect(
				effectivePushStatus({
					status,
					expiresAt: EARLIER,
					now: NOW,
					drifted: true,
				}),
			).toBe(status);
		}
	});
});

describe("pushExitCode", () => {
	test("only an accepted push exits 0", () => {
		const codes = Object.fromEntries(
			WORKFLOW_PUSH_STATUSES.map((status) => [status, pushExitCode(status)]),
		);
		expect(codes).toEqual({
			pending: 1,
			accepted: 0,
			rejected: 1,
			expired: 1,
			stale: 1,
		});
	});
});

describe("pushBlockingIssues", () => {
	const error = {
		rule: "no-action" as const,
		severity: "error" as const,
		step: "Trigger",
		message: "Add an action after the trigger.",
		fixes: [],
	};
	const unavailable = {
		...error,
		rule: "rule-unavailable" as const,
		message: "AI review has no credits.",
	};
	const warning = {
		...error,
		rule: "stale-reviewer" as const,
		severity: "warning" as const,
	};

	test("on a workflow that is on, errors block and warnings do not", () => {
		expect(pushBlockingIssues([error, unavailable, warning], true)).toEqual([
			error,
			unavailable,
		]);
	});

	test("a workflow that is off saves with errors, as apply does", () => {
		expect(pushBlockingIssues([error, unavailable, warning], false)).toEqual(
			[],
		);
	});
});

describe("schemas", () => {
	test("entries need at least one workflow", () => {
		expect(workflowPushEntriesSchema.safeParse([]).success).toBe(false);
	});

	test("a view parses with and without outcomes", () => {
		const parsed = workflowPushViewSchema.parse({
			id: "p1",
			org: "acme",
			repo: "acme/api",
			status: "accepted",
			url: "https://app.tripwire.sh/acme/api/workflows/review/p1",
			expiresAt: LATER.toISOString(),
			workflows: [
				{ id: "gate", name: "Gate", change: "changed", outcome: "updated" },
				{ id: "new-one", name: "New one", change: "new" },
			],
		});
		expect(parsed.workflows).toHaveLength(2);
	});
});
