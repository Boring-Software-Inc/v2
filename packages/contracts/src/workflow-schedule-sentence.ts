import type { ThreadSubject } from "./events.ts";
import type { ScheduleDraft, ScheduleState } from "./workflow.ts";
import { describeDuration, describeSchedule } from "./workflow-schedule.ts";

const SUBJECT_WORDS = {
	issue: "issues",
	"change-request": "change requests",
} as const satisfies Record<ThreadSubject, string>;

const STATE_WORDS = {
	open: "open",
	closed: "closed",
	any: "open and closed",
} as const satisfies Record<ScheduleState, string>;

export interface ScheduleSentencePart {
	key: string;
	text: string;
	placeholder?: boolean;
}

function joinWords(words: readonly string[], last: "and" | "or"): string {
	if (words.length <= 1) {
		return words[0] ?? "";
	}
	return `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}`;
}

export function scheduleSentence(
	draft: ScheduleDraft | undefined,
): ScheduleSentencePart[] {
	const match = draft?.match ?? {};
	const subjects = (["issue", "change-request"] as const).filter((subject) =>
		match.subjects?.includes(subject),
	);
	const parts: ScheduleSentencePart[] = draft?.every
		? [
				{
					key: "every",
					text: describeSchedule({
						every: draft.every,
						timezone: draft.timezone,
					}),
				},
			]
		: [
				{ key: "every-lead", text: "Every " },
				{ key: "every", text: "so often", placeholder: true },
			];
	parts.push(
		{ key: "finds", text: ", finds " },
		match.state
			? { key: "state", text: STATE_WORDS[match.state] }
			: { key: "state", text: "open or closed", placeholder: true },
		{ key: "gap", text: " " },
		subjects.length > 0
			? {
					key: "subjects",
					text: joinWords(
						subjects.map((s) => SUBJECT_WORDS[s]),
						"and",
					),
				}
			: {
					key: "subjects",
					text: "issues or change requests",
					placeholder: true,
				},
		{ key: "inactive-lead", text: " with no activity for " },
		match.inactiveFor
			? { key: "inactiveFor", text: describeDuration(match.inactiveFor) }
			: { key: "inactiveFor", text: "some time", placeholder: true },
	);
	if (match.labels?.length) {
		parts.push({
			key: "labels",
			text: `, labeled ${joinWords(match.labels, "and")}`,
		});
	}
	if (match.excludeLabels?.length) {
		parts.push({
			key: "excludeLabels",
			text: `, not labeled ${joinWords(match.excludeLabels, "or")}`,
		});
	}
	if (match.skipLocked !== false) {
		parts.push({ key: "skipLocked", text: ", skipping locked ones" });
	}
	parts.push({ key: "end", text: "." });
	return parts;
}

export function scheduleSentenceText(draft: ScheduleDraft | undefined): string {
	return scheduleSentence(draft)
		.map((part) => (part.placeholder ? `[${part.text}]` : part.text))
		.join("");
}

const STATE_PREFIX = {
	open: "Open",
	closed: "Closed",
	any: null,
} as const satisfies Record<ScheduleState, string | null>;

export function appliesToValue(
	subjects: readonly ThreadSubject[] | undefined,
	state: ScheduleState | undefined,
): string | null {
	const chosen = (["issue", "change-request"] as const).filter((subject) =>
		subjects?.includes(subject),
	);
	if (chosen.length === 0 || state === undefined) {
		return null;
	}
	const list = chosen.map((subject) => SUBJECT_WORDS[subject]).join(", ");
	const prefix = STATE_PREFIX[state];
	return prefix
		? `${prefix} ${list}`
		: `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
}

export function scheduleShortSummary(draft: ScheduleDraft | undefined): string {
	const every = draft?.every
		? describeSchedule({ every: draft.every, timezone: draft.timezone })
		: "Schedule not set";
	const applies = appliesToValue(draft?.match.subjects, draft?.match.state);
	const inactive = draft?.match.inactiveFor
		? `inactive ${describeDuration(draft.match.inactiveFor)}`
		: null;
	const rest = [applies?.toLowerCase(), inactive]
		.filter((part): part is string => Boolean(part))
		.join(" ");
	return rest ? `${every}, ${rest}` : every;
}
