import { describe, expect, test } from "bun:test";
import type { NormalizedEvent } from "@tripwire/contracts";
import { changeRequestForgeLink, eventForgeLink } from "#/lib/activity-links";

const base = {
	id: "evt-1",
	forge: "github" as const,
	deliveryId: "d-1",
	repo: {
		owner: "boring-software-inc",
		name: "scratch",
		fullName: "boring-software-inc/scratch",
	},
	actor: { login: "octo", externalId: "2" },
	occurredAt: "2026-10-21T10:00:00.000Z",
	receivedAt: "2026-10-21T10:00:00.000Z",
};

const opened: NormalizedEvent = {
	...base,
	kind: "change-request.opened",
	changeRequest: {
		number: 89,
		title: "Fix it",
		headSha: "abc",
		url: "https://github.com/boring-software-inc/scratch/pull/89",
	},
};

const comment: NormalizedEvent = {
	...base,
	kind: "comment.created",
	comment: {
		externalId: "c-1",
		body: "hi",
		url: "https://github.com/boring-software-inc/scratch/pull/89#c-1",
		subjectNumber: 89,
	},
};

const push: Extract<NormalizedEvent, { kind: "push" }> = {
	...base,
	kind: "push",
	push: { ref: "refs/heads/main", headSha: "abc", commitCount: 1 },
};

describe("eventForgeLink", () => {
	test("a change request names its number and forge", () => {
		expect(eventForgeLink(opened)).toEqual({
			href: "https://github.com/boring-software-inc/scratch/pull/89",
			label: "Open #89 on GitHub",
		});
	});

	test("a comment names the change request it sits on", () => {
		expect(eventForgeLink(comment)?.label).toBe(
			"Open the comment on #89 on GitHub",
		);
	});

	test("a push with no compare url has no link", () => {
		expect(eventForgeLink(push)).toBeNull();
	});

	test("a push with a compare url names its branch", () => {
		expect(
			eventForgeLink({
				...push,
				push: { ...push.push, url: "https://github.com/compare/a...b" },
			})?.label,
		).toBe("Open the push to main on GitHub");
	});
});

describe("changeRequestForgeLink", () => {
	test("labels the change request on its forge", () => {
		expect(
			changeRequestForgeLink("opengit", 7, "https://open.git/x/pull/7"),
		).toEqual({
			href: "https://open.git/x/pull/7",
			label: "Open #7 on OpenGit",
		});
	});

	test("no url, no link", () => {
		expect(changeRequestForgeLink("github", 7, null)).toBeNull();
	});
});

test("inactive branch collision extras never replace the active event's link", async () => {
	const { storedNormalizedEventSchema } = await import("@tripwire/contracts");
	const schedule: NormalizedEvent = {
		...base,
		kind: "schedule.matched",
		schedule: { workflowId: "w", nodeId: "n", tickId: "t" },
		thread: {
			kind: "issue",
			number: 9,
			title: "scheduled",
			url: "https://github.com/test/issues/9",
			state: "open",
			author: "octo",
			labels: [],
			locked: false,
			updatedAt: base.receivedAt,
		},
	};
	for (const event of [push, comment, schedule]) {
		const withExtras = storedNormalizedEventSchema.parse({
			...event,
			changeRequest: null,
			installation: 23,
		});
		expect(eventForgeLink(withExtras)).toEqual(eventForgeLink(event));
	}
	expect(
		eventForgeLink(
			storedNormalizedEventSchema.parse({ ...opened, installation: 23 }),
		),
	).toEqual(eventForgeLink(opened));
	const installation = storedNormalizedEventSchema.parse({
		...base,
		kind: "installation.created",
		installation: { externalId: "1", account: "octo" },
		repositories: [],
		changeRequest: null,
	});
	expect(eventForgeLink(installation)).toBeNull();
});
