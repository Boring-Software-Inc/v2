import {
	type EventKind,
	isScheduleTrigger,
	NEW_SCHEDULE_DRAFT,
	TRIGGER_CATALOG,
	type TriggerNode,
} from "@tripwire/contracts";

export type TriggerPath = "event" | "schedule";

export const EVENT_KIND_OPTIONS = TRIGGER_CATALOG.filter(
	(entry) => entry.toolbox && entry.kind !== "schedule.matched",
);

export function triggerPath(node: TriggerNode): TriggerPath {
	return isScheduleTrigger(node) || node.schedule !== undefined
		? "schedule"
		: "event";
}

export function switchTriggerPath(
	node: TriggerNode,
	path: TriggerPath,
): TriggerNode {
	if (triggerPath(node) === path) {
		return node;
	}
	const { schedule: _, ...rest } = node;
	return path === "schedule"
		? {
				...rest,
				kinds: ["schedule.matched"],
				schedule: structuredClone(NEW_SCHEDULE_DRAFT),
			}
		: { ...rest, kinds: [] };
}

export function toggleTriggerKind(
	node: TriggerNode,
	kind: EventKind,
	checked: boolean,
): TriggerNode {
	const { schedule, ...rest } = node;
	if (kind === "schedule.matched") {
		return checked
			? {
					...rest,
					kinds: [kind],
					schedule: schedule ?? structuredClone(NEW_SCHEDULE_DRAFT),
				}
			: { ...rest, kinds: node.kinds.filter((k) => k !== kind) };
	}
	if (checked) {
		return {
			...rest,
			kinds: [...node.kinds.filter((k) => k !== "schedule.matched"), kind],
		};
	}
	return { ...node, kinds: node.kinds.filter((k) => k !== kind) };
}

const WHEN_LABELS: Partial<Record<EventKind, string>> = {
	"change-request.opened": "A change request opens",
	"change-request.updated": "A change request gets new commits",
	"change-request.closed": "A change request closes",
	"comment.created": "Someone comments",
	push: "Someone pushes",
};

export function whenLabel(kind: EventKind): string {
	return (
		WHEN_LABELS[kind] ??
		TRIGGER_CATALOG.find((entry) => entry.kind === kind)?.name ??
		kind
	);
}

const CHANGE_REQUEST_VERBS: Partial<Record<EventKind, string>> = {
	"change-request.opened": "opens",
	"change-request.updated": "gets new commits",
	"change-request.closed": "closes",
};

const SOMEONE_VERBS: Partial<Record<EventKind, string>> = {
	"comment.created": "comments",
	push: "pushes",
};

function orList(words: readonly string[]): string {
	if (words.length <= 1) {
		return words[0] ?? "";
	}
	return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

export function whenSentence(kinds: readonly EventKind[]): string | null {
	const ordered = EVENT_KIND_OPTIONS.map((entry) => entry.kind).filter((kind) =>
		kinds.includes(kind),
	);
	const changeRequest = ordered.flatMap((kind) => {
		const verb = CHANGE_REQUEST_VERBS[kind];
		return verb ? [verb] : [];
	});
	const someone = ordered.flatMap((kind) => {
		const verb = SOMEONE_VERBS[kind];
		return verb ? [verb] : [];
	});
	const groups = [
		changeRequest.length > 0
			? `a change request ${orList(changeRequest)}`
			: null,
		someone.length > 0 ? `someone ${orList(someone)}` : null,
	].filter((group): group is string => group !== null);
	if (groups.length === 0) {
		return null;
	}
	const sentence = groups.join(", or ");
	return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}
