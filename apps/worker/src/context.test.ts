import { describe, expect, test } from "bun:test";
import type { RepoScopedEvent } from "@tripwire/contracts";
import type { ChangeRequestHead } from "@tripwire/forge";
import pino from "pino";
import { buildRuleContext, type WorkerReads } from "./context.ts";

const HEAD = "d125d3a".padEnd(40, "0");

function updatedEvent(baseRef: string | undefined): RepoScopedEvent {
	return {
		id: "evt-1",
		forge: "github",
		deliveryId: "delivery-1",
		repo: { owner: "acme", name: "app", fullName: "acme/app" },
		actor: { login: "octocat", externalId: "7" },
		occurredAt: "2026-10-23T17:40:00.000Z",
		receivedAt: "2026-10-23T17:40:01.000Z",
		kind: "change-request.updated",
		changeRequest: {
			number: 151,
			title: "Add d1b",
			headSha: HEAD,
			baseRef,
			url: "https://github.com/acme/app/pull/151",
		},
	};
}

function recordingReads() {
	const heads: { read: string; head: ChangeRequestHead | undefined }[] = [];
	const reads: WorkerReads = {
		getDiff: (_repo, _number, head) => {
			heads.push({ read: "diff", head });
			return Promise.resolve([]);
		},
		getCommits: (_repo, _number, head) => {
			heads.push({ read: "commits", head });
			return Promise.resolve([]);
		},
		getContributorProfile: () => Promise.reject(new Error("not needed")),
	};
	return { reads, heads };
}

describe("buildRuleContext reads the files of the event's own head", () => {
	test("diff and commits are read at the event's head SHA", async () => {
		const { reads, heads } = recordingReads();
		await buildRuleContext(
			updatedEvent("main"),
			reads,
			"2026-10-23T17:40:02.000Z",
			pino({ level: "silent" }),
		);
		const expected = { sha: HEAD, baseRef: "main" };
		expect(heads).toEqual([
			{ read: "diff", head: expected },
			{ read: "commits", head: expected },
		]);
	});

	test("an event without a base branch falls back to the current head", async () => {
		const { reads, heads } = recordingReads();
		await buildRuleContext(
			updatedEvent(undefined),
			reads,
			"2026-10-23T17:40:02.000Z",
			pino({ level: "silent" }),
		);
		expect(heads).toEqual([
			{ read: "diff", head: undefined },
			{ read: "commits", head: undefined },
		]);
	});
});
