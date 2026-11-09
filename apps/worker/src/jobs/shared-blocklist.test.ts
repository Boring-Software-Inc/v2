import { expect, test } from "bun:test";
import {
	normalizedEventSchema,
	SHARED_BLOCKLIST_MAX_AGE_MS,
	SHARED_BLOCKLIST_RULE_REF,
	type SharedBlocklistEvidence,
	sharedBlocklistSnapshotSchema,
	type WorkflowDefinition,
	workflowReadiness,
} from "@tripwire/contracts";
import { executeWorkflow } from "@tripwire/core";
import pino from "pino";
import { makeEvaluator } from "./run-workflows.ts";
import {
	sharedBlocklistEvidence,
	sharedBlocklistReviewWorkflow,
} from "./shared-blocklist.ts";

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
	const match = sharedBlocklistEvidence(event, snapshot, now);
	expect(match).toEqual({
		accountId: event.actor.externalId,
		reason: "Recorded test match",
		revision: 5,
	});
	expect(
		sharedBlocklistEvidence(
			{ ...event, actor: { ...event.actor, externalId: "1" } },
			snapshot,
			now,
		),
	).toEqual({ revision: 5 });
	const notListed = sharedBlocklistEvidence(
		event,
		{ ...snapshot, entries: [] },
		now,
	);
	expect(notListed).toEqual({ revision: 5 });
	const stale = sharedBlocklistEvidence(
		event,
		snapshot,
		now + SHARED_BLOCKLIST_MAX_AGE_MS,
	);
	expect(stale).toBeNull();
	const expired = sharedBlocklistSnapshotSchema.parse({
		...snapshot,
		entries: snapshot.entries.map((entry) => ({
			...entry,
			expiresAt: new Date(now).toISOString(),
		})),
	});
	expect(sharedBlocklistEvidence(event, expired, now)).toEqual({ revision: 5 });
	const permanent = sharedBlocklistSnapshotSchema.parse({
		...snapshot,
		entries: snapshot.entries.map(({ expiresAt: _, ...entry }) => entry),
	});
	expect(sharedBlocklistEvidence(event, permanent, now)).toEqual(match);

	const date = new Date(now).toISOString();
	const evaluator = (evidence: SharedBlocklistEvidence | null) =>
		makeEvaluator(
			{
				event,
				now: date,
				contributor: null,
				diff: null,
				commits: null,
				sharedBlocklist: evidence,
			},
			pino({ level: "silent" }),
		);
	const run = (
		definition: WorkflowDefinition,
		evidence: SharedBlocklistEvidence | null,
	) =>
		executeWorkflow({
			definition,
			event,
			now: () => date,
			evaluateRuleRef: evaluator(evidence),
		});

	const review = sharedBlocklistReviewWorkflow();
	expect((await run(review, match)).pausedAtNodeIds).toEqual(["review"]);
	expect((await run(review, notListed)).actions).toEqual([]);

	const authored: WorkflowDefinition = {
		...review,
		nodes: [
			{ id: "opened", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "pilot", type: "rule", ref: SHARED_BLOCKLIST_RULE_REF, config: {} },
			{ id: "close", type: "action", action: "close" },
			{ id: "lock", type: "action", action: "lock" },
		],
		edges: [
			{ id: "check", from: "opened", to: "pilot" },
			{ id: "matched", from: "pilot", to: "close", when: "fail" },
			{ id: "unlisted", from: "pilot", to: "lock", when: "pass" },
		],
	};
	expect(workflowReadiness(authored).canTurnOn).toBe(true);
	expect(
		(await run(authored, match)).actions.map(({ action }) => action),
	).toEqual(["close"]);
	expect(
		(await run(authored, notListed)).actions.map(({ action }) => action),
	).toEqual(["lock"]);
	expect((await run(authored, stale)).actions).toEqual([]);
	expect(
		(await run(authored, stale)).steps.find((step) => step.nodeId === "pilot")
			?.status,
	).toBe("skipped");
	expect(
		await evaluator(notListed)(SHARED_BLOCKLIST_RULE_REF, match),
	).toMatchObject({ status: "skipped" });
	expect(
		await evaluator(notListed)("shared-spam-blocklist@1", match),
	).toMatchObject({ status: "skipped" });

	const wrongTrigger: WorkflowDefinition = {
		...authored,
		nodes: authored.nodes.map((node) =>
			node.type === "trigger"
				? { ...node, kinds: ["change-request.updated"] }
				: node,
		),
	};
	expect(workflowReadiness(wrongTrigger).issues).toContainEqual(
		expect.objectContaining({ rule: "pilot-trigger", nodeId: "pilot" }),
	);
});
