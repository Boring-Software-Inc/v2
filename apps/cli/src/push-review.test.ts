import { describe, expect, test } from "bun:test";
import type { WorkflowPushView } from "@tripwire/contracts";
import { styleFor } from "#/format";
import {
	blockedText,
	canOpenBrowser,
	outcomeText,
	pushRefusalText,
	waitForDecision,
	waitingText,
} from "#/push-review";

const PLAIN = styleFor(false, {});

function view(over: Partial<WorkflowPushView> = {}): WorkflowPushView {
	return {
		id: "p1",
		org: "grim",
		repo: "grim/scratch",
		status: "pending",
		url: "https://app.tripwire.sh/grim/scratch/workflows/review/p1",
		expiresAt: "2026-10-24T13:00:00.000Z",
		workflows: [
			{ id: "new-accounts", name: "New accounts", change: "changed" },
		],
		...over,
	};
}

describe("canOpenBrowser", () => {
	test("a desktop opens the browser", () => {
		expect(canOpenBrowser({}, "darwin")).toBe(true);
		expect(canOpenBrowser({}, "win32")).toBe(true);
		expect(canOpenBrowser({ DISPLAY: ":0" }, "linux")).toBe(true);
		expect(canOpenBrowser({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(
			true,
		);
	});

	test("CI, SSH and a Linux box without a display do not", () => {
		expect(canOpenBrowser({ CI: "true" }, "darwin")).toBe(false);
		expect(canOpenBrowser({ CI: "1" }, "linux")).toBe(false);
		expect(canOpenBrowser({ SSH_CONNECTION: "1 2 3 4" }, "darwin")).toBe(false);
		expect(canOpenBrowser({}, "linux")).toBe(false);
	});

	test("TRIPWIRE_NO_BROWSER and BROWSER=none turn it off", () => {
		expect(canOpenBrowser({ TRIPWIRE_NO_BROWSER: "1" }, "darwin")).toBe(false);
		expect(canOpenBrowser({ BROWSER: "none" }, "darwin")).toBe(false);
		expect(canOpenBrowser({ CI: "false" }, "darwin")).toBe(true);
	});
});

describe("waitForDecision", () => {
	test("reads with the longest wait until the push is decided", async () => {
		const waits: number[] = [];
		const answers = [view(), view({ status: "accepted" })];
		const final = await waitForDecision(view(), {
			read: async (wait) => {
				waits.push(wait);
				return answers.shift() ?? view({ status: "expired" });
			},
			sleep: async () => undefined,
		});
		expect(final.status).toBe("accepted");
		expect(waits).toEqual([25, 25]);
	});

	test("rides out a few failed reads", async () => {
		let calls = 0;
		const sleeps: number[] = [];
		const final = await waitForDecision(view(), {
			read: async () => {
				calls += 1;
				if (calls < 3) {
					throw new Error("socket hang up");
				}
				return view({ status: "rejected" });
			},
			sleep: async (ms) => {
				sleeps.push(ms);
			},
		});
		expect(final.status).toBe("rejected");
		expect(sleeps).toEqual([2000, 2000]);
	});

	test("gives up after five failed reads in a row", async () => {
		await expect(
			waitForDecision(view(), {
				read: async () => {
					throw new Error("socket hang up");
				},
				sleep: async () => undefined,
			}),
		).rejects.toThrow("socket hang up");
	});

	test("a decided push needs no read", async () => {
		const final = await waitForDecision(view({ status: "stale" }), {
			read: async () => {
				throw new Error("should not read");
			},
			sleep: async () => undefined,
		});
		expect(final.status).toBe("stale");
	});
});

describe("copy", () => {
	test("waiting names the count and the repo", () => {
		expect(waitingText(view())).toBe(
			"Waiting for someone to accept 1 workflow on grim/scratch",
		);
	});

	test("an accepted push lists each outcome with its link", () => {
		expect(
			outcomeText(
				view({
					status: "accepted",
					workflows: [
						{
							id: "a",
							name: "New accounts",
							change: "changed",
							outcome: "updated",
							url: "https://app.tripwire.sh/grim/scratch/workflows/w1",
						},
						{ id: "b", name: "Rate limit", change: "new", outcome: "created" },
					],
				}),
				PLAIN,
			),
		).toBe(
			"updated   New accounts  https://app.tripwire.sh/grim/scratch/workflows/w1\ncreated   Rate limit",
		);
	});

	test("each refusal says nothing was saved", () => {
		for (const status of ["rejected", "expired", "stale"] as const) {
			expect(pushRefusalText(view({ status }), "scratch")).toContain(
				"Nothing was saved.",
			);
		}
		expect(pushRefusalText(view({ status: "stale" }), "scratch")).toContain(
			"tripwire workflows diff scratch",
		);
	});

	test("a blocked workflow names itself and its issues", () => {
		expect(
			blockedText(
				[{ name: "Gate", issues: ["Any of: It takes no inputs."] }],
				PLAIN,
			),
		).toBe(
			"error     Gate was not sent for review. Any of: It takes no inputs.",
		);
	});
});
