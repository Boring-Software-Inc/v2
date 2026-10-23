import { describe, expect, test } from "bun:test";
import { changeRequestAuthor } from "./activity.ts";
import type { NormalizedEvent } from "./events.ts";

const BASE = {
	forge: "github",
	repo: { owner: "acme", name: "scratch", fullName: "acme/scratch" },
	occurredAt: "2026-10-23T14:00:00.000Z",
	receivedAt: "2026-10-23T14:00:00.000Z",
} as const;

const OPENED: NormalizedEvent = {
	...BASE,
	id: "e1",
	deliveryId: "d1",
	actor: { login: "g-r-i-m", externalId: "1" },
	kind: "change-request.opened",
	changeRequest: {
		number: 132,
		title: "stale",
		headSha: "abc",
		url: "https://github.com/acme/scratch/pull/132",
	},
};

const BOT_COMMENT: NormalizedEvent = {
	...BASE,
	id: "e2",
	deliveryId: "d2",
	actor: { login: "tripwire-sh[bot]", externalId: "2" },
	kind: "comment.created",
	comment: {
		externalId: "c1",
		body: "x",
		url: "https://github.com/acme/scratch/pull/132#c1",
		subjectNumber: 132,
		byTripwire: true,
	},
};

const SCHEDULED: NormalizedEvent = {
	...BASE,
	id: "e3",
	deliveryId: "d3",
	actor: { login: "g-r-i-m", externalId: "1" },
	kind: "schedule.matched",
	schedule: { workflowId: "w", nodeId: "s", tickId: "t" },
	thread: {
		kind: "change-request",
		number: 132,
		title: "stale",
		url: "https://github.com/acme/scratch/pull/132",
		state: "open",
		author: "g-r-i-m",
		labels: [],
		locked: false,
		updatedAt: "2026-10-23T13:00:00.000Z",
	},
};

describe("an activity card names the change request's author", () => {
	test("never Tripwire's own comment, even when it came last", () => {
		expect(changeRequestAuthor([OPENED, SCHEDULED, BOT_COMMENT]).login).toBe(
			"g-r-i-m",
		);
	});

	test("a schedule names the thread author when no opened event is known", () => {
		expect(changeRequestAuthor([BOT_COMMENT, SCHEDULED]).login).toBe("g-r-i-m");
	});
});
