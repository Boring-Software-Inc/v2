import type {
	DurationUnit,
	ScheduleDraft,
	ScheduleState,
	ThreadSubject,
} from "@tripwire/contracts";

interface Duration {
	n: number;
	unit: DurationUnit;
}

const UNIT_WORDS = {
	hours: ["hour", "hours"],
	days: ["day", "days"],
	weeks: ["week", "weeks"],
	months: ["month", "months"],
} as const satisfies Record<DurationUnit, readonly [string, string]>;

export const UNIT_LABEL = {
	hours: "Hours",
	days: "Days",
	weeks: "Weeks",
	months: "Months",
} as const satisfies Record<DurationUnit, string>;

export function durationLabel(duration: Duration): string {
	const [one, many] = UNIT_WORDS[duration.unit];
	return `${duration.n} ${duration.n === 1 ? one : many}`;
}

export function everyLabel(every: Duration): string {
	if (every.n === 1) {
		return `Every ${UNIT_WORDS[every.unit][0]}`;
	}
	return `Every ${durationLabel(every)}`;
}

const SUBJECT_WORDS = {
	issue: "issues",
	"change-request": "change requests",
} as const satisfies Record<ThreadSubject, string>;

const STATE_WORDS = {
	open: "open",
	closed: "closed",
	any: "open and closed",
} as const satisfies Record<ScheduleState, string>;

export interface SentencePart {
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
): SentencePart[] {
	const match = draft?.match ?? {};
	const subjects = (["issue", "change-request"] as const).filter((subject) =>
		match.subjects?.includes(subject),
	);
	const parts: SentencePart[] = draft?.every
		? [{ key: "every", text: everyLabel(draft.every) }]
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
			? { key: "inactiveFor", text: durationLabel(match.inactiveFor) }
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
