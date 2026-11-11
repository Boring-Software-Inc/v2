import { expect, test } from "bun:test";
import {
	appealRestorationEventsSchema,
	appealRestorationThreadSchema,
	type JsonValue,
} from "@tripwire/contracts";
import type { ForgeAction } from "@tripwire/forge";
import issue from "../../fixtures/appeal-closed-issue.json" with {
	type: "json",
};
import events from "../../fixtures/appeal-issue-events.json" with {
	type: "json",
};
import { GithubHttp } from "../client/http.ts";
import { executeAction } from "./execute.ts";

const closeEvent = events[0];
if (!closeEvent) throw new Error("Expected a captured close event");
const timestamp = closeEvent.created_at;
function rig(
	options: {
		actor?: string;
		appId?: number;
		open?: boolean;
		changedHead?: boolean;
		changedAuthor?: boolean;
		late?: boolean;
		pull?: boolean;
	} = {},
) {
	const writes: string[] = [];
	const http = new GithubHttp({
		tokenFor: async () => "test",
		appId: 3169732,
		apiBase: "https://fake.api",
		fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
			const path = String(url).replace("https://fake.api", "");
			let body: JsonValue;
			if ((init?.method ?? "GET") !== "GET") {
				writes.push(`${init?.method} ${path}`);
				body = {};
			} else if (path.endsWith("/events?per_page=100"))
				body = events.map((e) => ({
					...e,
					created_at: options.late ? "2026-11-09T00:00:00Z" : e.created_at,
					actor: options.actor
						? { login: options.actor, type: "User" }
						: e.actor,
				}));
			else if (path.startsWith("/apps/"))
				body = { id: options.appId ?? 3169732 };
			else if (path.includes("/pulls/"))
				body = {
					merged: false,
					head: { sha: options.changedHead ? "new" : "old" },
				};
			else {
				body = {
					...issue,
					state: options.open ? "open" : "closed",
					user: {
						...issue.user,
						id: options.changedAuthor ? 123 : issue.user.id,
					},
				};
				if (options.pull) body.pull_request = {};
			}
			return new Response(JSON.stringify(body), { status: 200 });
		}) as typeof fetch,
	});
	const action: ForgeAction = {
		kind: "reopen",
		repoFullName: "Boring-Software-Inc/scratch",
		number: 182,
		guard: {
			authorId: String(issue.user.id),
			subject: options.pull ? "change-request" : "issue",
			headSha: options.pull ? "old" : undefined,
			appliedAfter: timestamp,
			appliedBefore: timestamp,
		},
	};
	return { http, action, writes };
}
test("captured issue and events match the restoration boundaries", () => {
	expect(appealRestorationThreadSchema.safeParse(issue).success).toBe(true);
	expect(appealRestorationEventsSchema.safeParse(events).success).toBe(true);
	expect(closeEvent.performed_via_github_app).toBeNull();
});
test("a verified app bot close is reversible when performed_via_github_app is null", async () => {
	const s = rig();
	expect(await executeAction(s.http, s.action)).toEqual({ externalId: null });
	expect(s.writes).toEqual([
		"PATCH /repos/Boring-Software-Inc/scratch/issues/182",
	]);
});
test.each([
	{ actor: "maintainer" },
	{ appId: 42 },
	{ late: true },
	{ changedAuthor: true },
	{ pull: true, changedHead: true },
])("changed actor, app, effect, author or head refuses restoration (%j)", async (options) => {
	const s = rig(options);
	expect(await executeAction(s.http, s.action)).toHaveProperty("refused", true);
	expect(s.writes).toHaveLength(0);
});
test("retrying a restored issue produces no mutation", async () => {
	const s = rig({ open: true });
	expect(await executeAction(s.http, s.action)).toEqual({ externalId: null });
	expect(s.writes).toHaveLength(0);
});

test("reopening a closed pull request uses the pull request endpoint", async () => {
	const s = rig({ pull: true });
	expect(await executeAction(s.http, s.action)).toEqual({ externalId: null });
	expect(s.writes).toEqual([
		"PATCH /repos/Boring-Software-Inc/scratch/pulls/182",
	]);
});
