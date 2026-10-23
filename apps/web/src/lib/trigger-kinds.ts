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

export interface EventSentencePart {
	key: string;
	text: string;
	placeholder?: boolean;
}

export function eventSentence(
	kinds: readonly EventKind[],
): EventSentencePart[] {
	const names = EVENT_KIND_OPTIONS.filter((entry) =>
		kinds.includes(entry.kind),
	).map((entry) => entry.name.toLowerCase());
	if (names.length === 0) {
		return [
			{ key: "lead", text: "Runs when " },
			{ key: "kinds", text: "something happens", placeholder: true },
			{ key: "end", text: "." },
		];
	}
	const joined =
		names.length === 1
			? (names[0] ?? "")
			: `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
	return [
		{ key: "lead", text: "Runs on " },
		{ key: "kinds", text: joined },
		{ key: "end", text: "." },
	];
}
