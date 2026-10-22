import {
	DEFAULT_TRIGGER_SCHEDULE,
	type EventKind,
	type TriggerNode,
} from "@tripwire/contracts";

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
					schedule: schedule ?? structuredClone(DEFAULT_TRIGGER_SCHEDULE),
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
