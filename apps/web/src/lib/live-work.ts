import type {
	WorkflowDefinition,
	WorkflowDraftView,
	WorkflowWork,
} from "@tripwire/contracts";
import type { WorkflowCard, WorkflowDetail } from "#/lib/workflows.functions";

export interface Merged<T> {
	data: T;
	refetch: boolean;
}

function openDraft(work: WorkflowWork): WorkflowDraftView | null {
	return work.draft?.status === "open" ? work.draft : null;
}

function triggerKinds(definition: WorkflowDefinition | null): string[] {
	return [
		...new Set(
			(definition?.nodes ?? []).flatMap((node) =>
				node.type === "trigger" ? node.kinds : [],
			),
		),
	];
}

function draftCard(draft: WorkflowDraftView, work: WorkflowWork): WorkflowCard {
	return {
		id: draft.id,
		name: draft.name,
		enabled: false,
		nodeCount: draft.definition?.nodes.length ?? 0,
		triggerKinds: triggerKinds(draft.definition),
		schedules: [],
		updatedAt: draft.updatedAt,
		runnable: false,
		canTurnOn: false,
		state: "off",
		draftId: draft.id,
		work,
	};
}

function sameWork(card: WorkflowCard, work: WorkflowWork): boolean {
	return (
		card.work?.definitionId === work.definitionId ||
		(work.workflowId !== null && card.id === work.workflowId) ||
		(work.draft !== null && card.draftId === work.draft.id)
	);
}

function isDraftOnly(card: WorkflowCard): boolean {
	return card.draftId !== null && card.id === card.draftId;
}

/**
 * Folds one live work message into the workflows list. A new draft is added,
 * a draft that ends leaves, and a promotion asks for a refetch so the saved
 * workflow takes its place.
 */
export function mergeWorkIntoCards(
	cards: WorkflowCard[] | undefined,
	work: WorkflowWork,
): Merged<WorkflowCard[] | undefined> {
	if (!cards) {
		return { data: cards, refetch: false };
	}
	const draft = openDraft(work);
	const index = cards.findIndex((card) => sameWork(card, work));
	const found = index >= 0 ? cards[index] : undefined;
	if (!found) {
		if (draft && work.workflowId === null) {
			return { data: [...cards, draftCard(draft, work)], refetch: false };
		}
		return {
			data: cards,
			refetch: draft !== null || work.draft?.status === "promoted",
		};
	}
	if (!draft && isDraftOnly(found)) {
		return {
			data: cards.filter((_, i) => i !== index),
			refetch: work.draft?.status === "promoted",
		};
	}
	const next: WorkflowCard =
		draft && isDraftOnly(found)
			? draftCard(draft, work)
			: {
					...found,
					draftId: draft?.id ?? null,
					work: { ...work, workflowId: found.id },
				};
	return {
		data: cards.map((card, i) => (i === index ? next : card)),
		refetch: work.draft?.status === "promoted" && !isDraftOnly(found),
	};
}

function blank(work: WorkflowWork, name: string): WorkflowDefinition {
	return { id: work.definitionId, name, version: 1, nodes: [], edges: [] };
}

/** Folds one live work message into an open editor's workflow. */
export function mergeWorkIntoDetail(
	detail: WorkflowDetail | null | undefined,
	work: WorkflowWork,
): Merged<WorkflowDetail | null | undefined> {
	if (!detail) {
		return { data: detail, refetch: false };
	}
	const matches =
		detail.work?.definitionId === work.definitionId ||
		detail.definition.id === work.definitionId ||
		detail.id === work.workflowId;
	if (!matches) {
		return { data: detail, refetch: false };
	}
	const draft = openDraft(work);
	const draftOnly = detail.draftId !== null && detail.id === detail.draftId;
	if (!draft && draftOnly) {
		return { data: detail, refetch: true };
	}
	if (draft && draftOnly) {
		const definition = draft.definition ?? blank(work, draft.name);
		return {
			data: {
				...detail,
				name: draft.name,
				definition,
				nodeCount: definition.nodes.length,
				triggerKinds: triggerKinds(definition),
				updatedAt: draft.updatedAt,
				work,
			},
			refetch: false,
		};
	}
	return {
		data: {
			...detail,
			draftId: draft?.id ?? null,
			work: { ...work, workflowId: detail.id },
		},
		refetch: work.draft?.status === "promoted",
	};
}

/** What the canvas shows: an open draft wins over the saved definition. */
export function shownDefinition(detail: WorkflowDetail): WorkflowDefinition {
	const draft = detail.work?.draft;
	if (draft?.status === "open" && draft.definition) {
		return draft.definition;
	}
	return detail.definition;
}
