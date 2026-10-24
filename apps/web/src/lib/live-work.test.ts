import { describe, expect, test } from "bun:test";
import type {
	WorkflowDefinition,
	WorkflowDraftView,
	WorkflowWork,
} from "@tripwire/contracts";
import {
	mergeWorkIntoCards,
	mergeWorkIntoDetail,
	shownDefinition,
} from "#/lib/live-work";
import type { WorkflowCard, WorkflowDetail } from "#/lib/workflows.functions";

const STAMP = "2026-10-24T12:00:00.000Z";

const definition: WorkflowDefinition = {
	id: "def-stale",
	name: "Close stale PRs",
	version: 1,
	nodes: [{ id: "t", type: "trigger", kinds: ["schedule.matched"] }],
	edges: [],
};

function draft(overrides: Partial<WorkflowDraftView> = {}): WorkflowDraftView {
	return {
		id: "draft-1",
		name: "Close stale PRs",
		status: "open",
		definition,
		revision: 1,
		lastChange: null,
		createdAt: STAMP,
		updatedAt: STAMP,
		expiresAt: STAMP,
		...overrides,
	};
}

function work(overrides: Partial<WorkflowWork> = {}): WorkflowWork {
	return {
		repoId: "repo-1",
		definitionId: "def-stale",
		workflowId: null,
		draft: draft(),
		agents: [],
		...overrides,
	};
}

function saved(overrides: Partial<WorkflowCard> = {}): WorkflowCard {
	return {
		id: "wf-1",
		name: "Label first-timers",
		enabled: true,
		nodeCount: 3,
		triggerKinds: ["change-request.opened"],
		schedules: [],
		updatedAt: STAMP,
		runnable: true,
		canTurnOn: true,
		state: "on",
		draftId: null,
		work: null,
		...overrides,
	};
}

describe("mergeWorkIntoCards", () => {
	test("a new draft joins the list as a draft card", () => {
		const merged = mergeWorkIntoCards([saved()], work());
		expect(merged.refetch).toBe(false);
		expect(merged.data?.map((card) => [card.id, card.draftId])).toEqual([
			["wf-1", null],
			["draft-1", "draft-1"],
		]);
		expect(merged.data?.[1]?.triggerKinds).toEqual(["schedule.matched"]);
	});

	test("a later message updates the draft card in place", () => {
		const first = mergeWorkIntoCards([], work()).data ?? [];
		const renamed = mergeWorkIntoCards(
			first,
			work({ draft: draft({ name: "Close old PRs", revision: 2 }) }),
		);
		expect(renamed.data).toHaveLength(1);
		expect(renamed.data?.[0]?.name).toBe("Close old PRs");
	});

	test("a discarded draft leaves the list", () => {
		const first = mergeWorkIntoCards([saved()], work()).data ?? [];
		const gone = mergeWorkIntoCards(
			first,
			work({ draft: draft({ status: "discarded" }) }),
		);
		expect(gone.data?.map((card) => card.id)).toEqual(["wf-1"]);
		expect(gone.refetch).toBe(false);
	});

	test("a promoted draft leaves and asks for the saved workflow", () => {
		const first = mergeWorkIntoCards([], work()).data ?? [];
		const promoted = mergeWorkIntoCards(
			first,
			work({ workflowId: "wf-9", draft: draft({ status: "promoted" }) }),
		);
		expect(promoted.data).toEqual([]);
		expect(promoted.refetch).toBe(true);
	});

	test("a draft of a saved workflow marks that card and keeps it on", () => {
		const merged = mergeWorkIntoCards(
			[saved()],
			work({ workflowId: "wf-1", definitionId: "def-label" }),
		);
		expect(merged.data).toHaveLength(1);
		expect(merged.data?.[0]?.draftId).toBe("draft-1");
		expect(merged.data?.[0]?.enabled).toBe(true);
		expect(merged.data?.[0]?.work?.workflowId).toBe("wf-1");
	});

	test("agents finishing on a saved workflow keep the card", () => {
		const marked = mergeWorkIntoCards(
			[saved()],
			work({ workflowId: "wf-1", definitionId: "def-label" }),
		).data;
		const finished = mergeWorkIntoCards(
			marked,
			work({ workflowId: "wf-1", definitionId: "def-label", draft: null }),
		);
		expect(finished.data?.[0]?.draftId).toBeNull();
		expect(finished.data?.[0]?.id).toBe("wf-1");
	});

	test("an unloaded list stays unloaded", () => {
		expect(mergeWorkIntoCards(undefined, work()).data).toBeUndefined();
	});
});

function detail(overrides: Partial<WorkflowDetail> = {}): WorkflowDetail {
	return {
		...saved({ id: "draft-1", draftId: "draft-1", enabled: false }),
		definition: { ...definition, nodes: [] },
		lastTicks: {},
		...overrides,
	};
}

describe("mergeWorkIntoDetail", () => {
	test("a draft-only editor takes each new definition as it lands", () => {
		const merged = mergeWorkIntoDetail(detail(), work());
		expect(merged.data?.definition.nodes).toHaveLength(1);
		expect(merged.refetch).toBe(false);
	});

	test("a draft that ends sends the editor back to the server", () => {
		const merged = mergeWorkIntoDetail(
			detail(),
			work({ draft: draft({ status: "promoted" }), workflowId: "wf-2" }),
		);
		expect(merged.refetch).toBe(true);
	});

	test("another workflow's work is ignored", () => {
		const other = detail({ id: "wf-7", draftId: null });
		const merged = mergeWorkIntoDetail(
			{ ...other, definition: { ...definition, id: "def-other" } },
			work(),
		);
		expect(merged.data).toEqual({
			...other,
			definition: { ...definition, id: "def-other" },
		});
	});

	test("a saved workflow shows its open draft on the canvas", () => {
		const live = detail({
			id: "wf-1",
			draftId: null,
			definition: { ...definition, nodes: [] },
		});
		const merged = mergeWorkIntoDetail(live, work({ workflowId: "wf-1" }));
		const next = merged.data ?? live;
		expect(next.draftId).toBe("draft-1");
		expect(next.definition.nodes).toEqual([]);
		expect(shownDefinition(next).nodes).toHaveLength(1);
	});
});
