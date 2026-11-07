import { expect, test } from "bun:test";
import {
	normalizedEventSchema,
	SHARED_BLOCKLIST_MAX_AGE_MS,
	sharedBlocklistAvailable,
	sharedBlocklistSnapshotSchema,
} from "@tripwire/contracts";
import { evaluateRule, executeWorkflow, getRule } from "@tripwire/core";
import { sharedBlocklistReviewWorkflow } from "./shared-blocklist.ts";

test("only an exact account ID on a fresh list can queue human review", async () => {
	const event = normalizedEventSchema.parse(
		await Bun.file(
			new URL(
				"../../../../packages/core/fixtures/change-request.opened.event.json",
				import.meta.url,
			),
		).json(),
	);
	if (event.kind !== "change-request.opened")
		throw new Error("Expected an opened pull request");
	const now = Date.parse("2026-11-07T12:00:00Z");
	const snapshot = sharedBlocklistSnapshotSchema.parse({
		version: 1,
		revision: 5,
		publishedAt: new Date(now - 1_000).toISOString(),
		entries: [
			{
				accountId: event.actor.externalId,
				login: "older-handle",
				reason: "Recorded test match",
				expiresAt: new Date(
					now + SHARED_BLOCKLIST_MAX_AGE_MS * 2,
				).toISOString(),
			},
		],
	});
	expect(
		sharedBlocklistAvailable(undefined, { forge: "github", externalId: "1" }),
	).toBe(false);
	expect(
		sharedBlocklistAvailable("1", { forge: "gitcafe", externalId: "1" }),
	).toBe(false);
	expect(
		sharedBlocklistAvailable("1", { forge: "github", externalId: "1" }),
	).toBe(true);
	expect(
		sharedBlocklistReviewWorkflow(
			{ ...event, actor: { ...event.actor, externalId: "1" } },
			snapshot,
			now,
		),
	).toBeNull();
	expect(
		sharedBlocklistReviewWorkflow(
			event,
			snapshot,
			now + SHARED_BLOCKLIST_MAX_AGE_MS,
		),
	).toBeNull();
	expect(
		sharedBlocklistReviewWorkflow(event, { ...snapshot, entries: [] }, now),
	).toBeNull();
	const definition = sharedBlocklistReviewWorkflow(event, snapshot, now);
	expect(definition).not.toBeNull();
	if (!definition) throw new Error("Expected a review workflow");
	const date = new Date(now).toISOString();
	const result = await executeWorkflow({
		definition,
		event,
		now: () => date,
		evaluateRuleRef: (ref, config) => {
			const rule = getRule(ref);
			if (!rule) throw new Error("Expected a registered rule");
			return evaluateRule(
				rule,
				{ event, now: date, contributor: null, diff: null, commits: null },
				config,
			);
		},
	});
	expect(result.verdict).toBe("needs_review");
	expect(result.pausedAtNodeIds).toEqual(["review"]);
	expect(
		result.actions.every(
			({ action }) => action !== "block" && action !== "close",
		),
	).toBe(true);
});
