import {
	isScheduleInterval,
	isScheduleTrigger,
	parseScheduleText,
	type ScheduleCadence,
	type WorkflowNode,
} from "@tripwire/contracts";
import { zoneOffsetName } from "#/lib/timezones";

export function isClockCadence(cadence: ScheduleCadence | undefined): boolean {
	return cadence !== undefined && !isScheduleInterval(cadence);
}

export interface InvalidScheduleDraft {
	nodeId: string;
	message: string;
}

export function invalidScheduleDrafts(
	drafts: ReadonlyMap<string, string>,
	nodes: readonly WorkflowNode[],
): InvalidScheduleDraft[] {
	return nodes.flatMap((node) => {
		const text = drafts.get(node.id);
		if (text === undefined || !isScheduleTrigger(node)) {
			return [];
		}
		const parsed = parseScheduleText(text);
		if (parsed.ok || parsed.reason === "empty") {
			return [];
		}
		return [{ nodeId: node.id, message: parsed.message }];
	});
}

export function formatNextRun(instant: Date, zone: string): string {
	const date = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(instant);
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone: zone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(instant);
	return `${date}, ${time} ${zoneOffsetName(instant, zone)}`;
}
