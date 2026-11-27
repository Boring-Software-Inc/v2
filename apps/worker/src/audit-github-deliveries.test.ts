import { describe, expect, test } from "bun:test";
import type { deliveryAuditServices } from "@tripwire/db";
import type { GithubDelivery } from "@tripwire/forge-github";
import pino from "pino";
import editedByBot from "../../../packages/forge-github/fixtures/pull_request.edited.body-by-bot.json";
import pullRequestOpened from "../../../packages/forge-github/fixtures/pull_request.opened.json";
import {
	auditGithubDeliveries,
	REDELIVERY_WAIT_MS,
} from "./jobs/audit-github-deliveries.ts";

type Store = deliveryAuditServices.DeliveryAuditStore;
type Problem = Parameters<Store["recordDeliveryProblem"]>[0];

const NOW = new Date("2026-11-27T03:00:00Z");
const ARMED_REPO = "42";
const OFF_REPO = "43";
const CLAIMED_INSTALL = "7";

function attempt(overrides: Partial<GithubDelivery>): GithubDelivery {
	return {
		id: "1",
		guid: "guid-1",
		deliveredAt: new Date("2026-11-27T02:50:00Z"),
		redelivery: false,
		statusCode: 200,
		event: "pull_request",
		action: "opened",
		installationId: CLAIMED_INSTALL,
		repositoryId: ARMED_REPO,
		...overrides,
	};
}

/** Before every attempt in these tests: settings that predate the deliveries. */
const SETTLED = new Date("2026-11-01T00:00:00Z");

function fakeStore(
	state: {
		stored?: string[];
		problems?: Map<string, { status: Problem["status"]; updatedAt: Date }>;
		/** When the armed repo's settings last changed. */
		armedChangedAt?: Date;
	} = {},
) {
	const stored = new Set(state.stored ?? []);
	const problems = state.problems ?? new Map();
	const recorded: Problem[] = [];
	const statuses: [string, Problem["status"]][] = [];
	let cursor: Date | null = null;
	const store: Store = {
		readCursor: async () => cursor,
		advanceCursor: async (position) => {
			cursor = position;
		},
		storedDeliveryGuids: async (guids) =>
			new Set(guids.filter((guid) => stored.has(guid))),
		deliveryTargets: async () => ({
			repos: new Map([
				[
					ARMED_REPO,
					{
						armed: true,
						claimed: true,
						removed: false,
						pushTriggered: false,
						changedAt: state.armedChangedAt ?? SETTLED,
					},
				],
				[
					OFF_REPO,
					{
						armed: false,
						claimed: true,
						removed: false,
						pushTriggered: false,
						changedAt: SETTLED,
					},
				],
			]),
			claimedInstallations: new Map([[CLAIMED_INSTALL, SETTLED]]),
		}),
		deliveryProblems: async (guids) =>
			new Map([...problems].filter(([guid]) => guids.includes(guid))),
		recordDeliveryProblem: async (problem) => {
			recorded.push(problem);
			problems.set(problem.guid, { status: problem.status, updatedAt: NOW });
		},
		redeliveriesUpdatedBefore: async (before) =>
			[...problems]
				.filter(
					([, problem]) =>
						problem.status === "redelivered" && problem.updatedAt < before,
				)
				.map(([guid]) => ({ guid, event: "pull_request" })),
		lostDeliveryGuids: async () =>
			[...problems]
				.filter(
					([, problem]) =>
						problem.status === "missed" || problem.status === "failed",
				)
				.map(([guid]) => guid),
		setDeliveryProblemStatus: async (guid, status) => {
			statuses.push([guid, status]);
			problems.set(guid, { status, updatedAt: NOW });
		},
		prune: async () => {},
	};
	return { store, recorded, statuses, cursor: () => cursor };
}

function fakeDeliveries(
	attempts: GithubDelivery[],
	payloads = new Map<string, object>(),
) {
	const redelivered: string[] = [];
	const reads: string[] = [];
	return {
		redelivered,
		reads,
		deliveries: {
			listSince: async (since: Date) =>
				attempts.filter((a) => a.deliveredAt >= since),
			payload: async (id: string) => {
				reads.push(id);
				return {
					event: "pull_request",
					body: JSON.stringify(payloads.get(id) ?? pullRequestOpened),
				};
			},
			redeliver: async (id: string) => {
				redelivered.push(id);
			},
		},
	};
}

const logger = pino({ level: "silent" });

describe("auditGithubDeliveries", () => {
	test("a stored delivery needs nothing", async () => {
		const { store, recorded } = fakeStore({ stored: ["guid-1"] });
		const { deliveries, redelivered } = fakeDeliveries([attempt({})]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.checked).toBe(1);
		expect(recorded).toEqual([]);
		expect(redelivered).toEqual([]);
	});

	test("a delivery ingest never answered is redelivered once", async () => {
		const { store, recorded } = fakeStore();
		const { deliveries, redelivered } = fakeDeliveries([
			attempt({ id: "5", statusCode: 502 }),
		]);
		await auditGithubDeliveries({ store, deliveries, logger, now: () => NOW });
		expect(redelivered).toEqual(["5"]);
		expect(recorded.map((p) => p.status)).toEqual(["redelivered"]);

		// The next run doesn't ask again while the redelivery is pending.
		await auditGithubDeliveries({ store, deliveries, logger, now: () => NOW });
		expect(redelivered).toEqual(["5"]);
	});

	test("a redelivery that fails too pages", async () => {
		const { store, recorded } = fakeStore({
			problems: new Map([
				[
					"guid-1",
					{
						status: "redelivered",
						updatedAt: new Date(NOW.getTime() - REDELIVERY_WAIT_MS - 1),
					},
				],
			]),
		});
		const { deliveries } = fakeDeliveries([
			attempt({ id: "5", statusCode: 502 }),
			attempt({
				id: "6",
				statusCode: 500,
				redelivery: true,
				deliveredAt: new Date("2026-11-27T02:55:00Z"),
			}),
		]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.failed).toBe(1);
		expect(recorded.at(-1)).toMatchObject({ status: "failed", attemptId: "6" });
	});

	test("a redelivery GitHub never sent pages once it is out of the log window", async () => {
		const { store, statuses } = fakeStore({
			problems: new Map([
				[
					"guid-old",
					{
						status: "redelivered",
						updatedAt: new Date(NOW.getTime() - REDELIVERY_WAIT_MS - 1),
					},
				],
			]),
		});
		const { deliveries } = fakeDeliveries([]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.failed).toBe(1);
		expect(statuses).toEqual([["guid-old", "failed"]]);
	});

	test("a lost delivery stored after it left the scan window stops paging", async () => {
		const { store, statuses } = fakeStore({
			stored: ["guid-missed", "guid-failed"],
			problems: new Map([
				["guid-missed", { status: "missed", updatedAt: NOW }],
				["guid-failed", { status: "failed", updatedAt: NOW }],
				["guid-still-lost", { status: "missed", updatedAt: NOW }],
			]),
		});
		const { deliveries } = fakeDeliveries([]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.recovered).toBe(2);
		expect(statuses).toEqual([
			["guid-missed", "recovered"],
			["guid-failed", "recovered"],
		]);
	});

	test("a delivery answered 200 but never stored pages as missed", async () => {
		const { store, recorded } = fakeStore();
		const { deliveries, redelivered } = fakeDeliveries([attempt({ id: "9" })]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.missed).toBe(1);
		expect(recorded).toMatchObject([{ guid: "guid-1", status: "missed" }]);
		// Redelivering would only reach the same bug.
		expect(redelivered).toEqual([]);
	});

	test("a bot edit that normalizes to nothing is read once, not paged", async () => {
		const { store, recorded } = fakeStore();
		const { deliveries, reads } = fakeDeliveries(
			[attempt({ id: "9", action: "edited" })],
			new Map([["9", editedByBot]]),
		);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.missed).toBe(0);
		expect(recorded.map((p) => p.status)).toEqual(["ignored"]);

		// The overlap rescans it; its payload isn't read again.
		await auditGithubDeliveries({ store, deliveries, logger, now: () => NOW });
		expect(reads).toEqual(["9"]);
	});

	test("a redelivered no-op edit resolves instead of paging later", async () => {
		const { store, recorded } = fakeStore({
			problems: new Map([
				["guid-1", { status: "redelivered", updatedAt: NOW }],
			]),
		});
		const { deliveries } = fakeDeliveries(
			[
				attempt({ id: "5", action: "edited", statusCode: 502 }),
				attempt({
					id: "6",
					action: "edited",
					redelivery: true,
					deliveredAt: new Date("2026-11-27T02:55:00Z"),
				}),
			],
			new Map([["6", editedByBot]]),
		);
		await auditGithubDeliveries({ store, deliveries, logger, now: () => NOW });
		expect(recorded.at(-1)).toMatchObject({
			status: "ignored",
			attemptId: "6",
		});
		const later = new Date(NOW.getTime() + REDELIVERY_WAIT_MS * 2);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => later,
		});
		expect(summary.failed).toBe(0);
	});

	test("a delivery from before the repo was armed is not called missed", async () => {
		// A comment dropped while Tripwire was off; the repo was armed after.
		const { store, recorded } = fakeStore({
			armedChangedAt: new Date("2026-11-27T02:52:00Z"),
		});
		const { deliveries, reads } = fakeDeliveries([
			attempt({ event: "issue_comment", action: "created" }),
		]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.missed).toBe(0);
		expect(recorded).toEqual([]);
		expect(reads).toEqual([]);
	});

	test("deliveries ingest may drop are not checked", async () => {
		const { store, recorded } = fakeStore();
		const { deliveries, redelivered } = fakeDeliveries([
			// A comment on a repo with Tripwire off.
			attempt({
				guid: "a",
				event: "issue_comment",
				action: "created",
				repositoryId: OFF_REPO,
			}),
			// An installation no org has claimed, even when every attempt failed.
			attempt({
				guid: "b",
				installationId: "99",
				repositoryId: "77",
				statusCode: 502,
			}),
			// Never on the ingest allow-list.
			attempt({ guid: "c", event: "check_suite", action: "requested" }),
		]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.checked).toBe(0);
		expect(recorded).toEqual([]);
		expect(redelivered).toEqual([]);
	});

	test("a lost delivery stored later is marked recovered", async () => {
		const { store, recorded } = fakeStore({
			stored: ["guid-1"],
			problems: new Map([
				["guid-1", { status: "redelivered", updatedAt: NOW }],
			]),
		});
		const { deliveries } = fakeDeliveries([
			attempt({ id: "5", statusCode: 502 }),
			attempt({
				id: "6",
				redelivery: true,
				deliveredAt: new Date("2026-11-27T02:55:00Z"),
			}),
		]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.recovered).toBe(1);
		expect(recorded.at(-1)?.status).toBe("recovered");
	});

	test("the cursor skips deliveries still in flight", async () => {
		const { store, cursor } = fakeStore();
		const { deliveries } = fakeDeliveries([
			attempt({ deliveredAt: new Date(NOW.getTime() - 10_000) }),
		]);
		const summary = await auditGithubDeliveries({
			store,
			deliveries,
			logger,
			now: () => NOW,
		});
		expect(summary.checked).toBe(0);
		expect(cursor()).toEqual(new Date(NOW.getTime() - 60_000));
	});
});
