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
