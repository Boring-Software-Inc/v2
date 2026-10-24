import type {
	FlagOverrideChoice,
	FlagSource,
	FlagSyncStatus,
} from "@tripwire/contracts";

export type SheetStep =
	| { kind: "user"; id: string }
	| { kind: "page"; offset: number; pick: "first" | "last" }
	| null;

export interface SheetPosition {
	label: string;
	prev: SheetStep;
	next: SheetStep;
}

export function sheetPosition(input: {
	ids: readonly string[];
	offset: number;
	pageSize: number;
	total: number;
	userId: string;
}): SheetPosition {
	const index = input.ids.indexOf(input.userId);
	if (index < 0) {
		return { label: "User", prev: null, next: null };
	}
	const absolute = input.offset + index;
	const prevId = input.ids[index - 1];
	const nextId = input.ids[index + 1];
	const prev: SheetStep = prevId
		? { kind: "user", id: prevId }
		: absolute > 0
			? {
					kind: "page",
					offset: Math.max(0, input.offset - input.pageSize),
					pick: "last",
				}
			: null;
	const next: SheetStep = nextId
		? { kind: "user", id: nextId }
		: absolute + 1 < input.total
			? { kind: "page", offset: input.offset + input.pageSize, pick: "first" }
			: null;
	return {
		label: `User ${absolute + 1} of ${input.total}`,
		prev,
		next,
	};
}

export function pickFromPage(
	ids: readonly string[],
	pick: "first" | "last",
): string | null {
	return (pick === "first" ? ids[0] : ids.at(-1)) ?? null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatWait(ms: number): string {
	if (!Number.isFinite(ms) || ms < MINUTE) {
		return "Under 1 min";
	}
	const days = Math.floor(ms / DAY);
	const hours = Math.floor((ms % DAY) / HOUR);
	const minutes = Math.floor((ms % HOUR) / MINUTE);
	if (days > 0) {
		return hours > 0 ? `${days} d ${hours} hr` : `${days} d`;
	}
	if (hours > 0) {
		return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
	}
	return `${minutes} min`;
}

export function historySentence(entry: {
	actorName: string | null;
	flagKey: string;
	from: FlagOverrideChoice;
	to: FlagOverrideChoice;
}): string {
	const actor = entry.actorName ?? "A deleted staff member";
	if (entry.to === "default") {
		return `${actor} reset ${entry.flagKey} to default`;
	}
	if (entry.to === "on" && entry.from === "default") {
		return `${actor} flagged them in to ${entry.flagKey}`;
	}
	return `${actor} turned ${entry.flagKey} ${entry.to}`;
}

const SOURCE_LABELS = {
	default: "Default",
	rule: "Their rule",
	group: "Group",
	rollout: "Rollout",
	unknown: "Unknown",
} satisfies Record<FlagSource, string>;

export function flagSourceLabel(
	source: FlagSource,
	override: {
		choice: FlagOverrideChoice;
		syncStatus: FlagSyncStatus;
	} | null = null,
): string {
	if (
		source === "rule" &&
		override?.choice !== undefined &&
		override.choice !== "default" &&
		override.syncStatus === "synced"
	) {
		return "Tripwire override";
	}
	return SOURCE_LABELS[source];
}

export type SyncTone = "ok" | "warn" | "fail" | "quiet";

export interface FlagSyncLabel {
	tone: SyncTone;
	label: string;
}

export interface VerdictLabel {
	label: string;
	tone: "fail" | "plain";
}

export function flagSyncLabel(input: {
	connected: boolean;
	inDatabuddy: boolean | null;
	syncStatus: FlagSyncStatus | null;
}): FlagSyncLabel {
	if (!input.connected) {
		return { tone: "quiet", label: "Not connected" };
	}
	if (input.syncStatus === "pending") {
		return { tone: "warn", label: "Pending" };
	}
	if (input.syncStatus === "failed") {
		return { tone: "fail", label: "Failed" };
	}
	if (input.syncStatus === null && input.inDatabuddy === false) {
		return { tone: "quiet", label: "Not in Databuddy" };
	}
	return { tone: "ok", label: "Synced" };
}

export function moderationDecisionLabel(status: string): string {
	if (status === "approved") {
		return "Approved";
	}
	if (status === "denied") {
		return "Blocked";
	}
	if (status === "closed") {
		return "Closed";
	}
	return "Pending";
}

export function contributorVerdictLabel(verdict: string | null): VerdictLabel {
	if (verdict === "block") {
		return { label: "Blocked", tone: "fail" };
	}
	if (verdict === "pass") {
		return { label: "Passed", tone: "plain" };
	}
	if (verdict === "needs_review") {
		return { label: "Human review", tone: "plain" };
	}
	return { label: "Running", tone: "plain" };
}

export function changeRequestLabel(
	repoFullName: string,
	subjectNumber: number | null,
): string {
	return subjectNumber === null
		? repoFullName
		: `${repoFullName} #${subjectNumber}`;
}

export function providerLabel(providerId: string): string {
	if (providerId === "github") {
		return "GitHub";
	}
	if (providerId === "opengit") {
		return "open-git";
	}
	if (providerId === "credential") {
		return "Email";
	}
	return providerId;
}

export function minutesLeft(expiresAt: string, now: number): number {
	return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / MINUTE));
}

export const SHEET_SECTIONS = [
	{ id: "access", label: "Access" },
	{ id: "flags", label: "Flags" },
	{ id: "account", label: "Account" },
	{ id: "moderation", label: "Moderation" },
	{ id: "activity", label: "Activity" },
	{ id: "danger", label: "Danger" },
] as const;

export type SheetSectionId = (typeof SHEET_SECTIONS)[number]["id"];

export function activeSectionAt(
	tops: readonly { id: SheetSectionId; top: number }[],
	line: number,
): SheetSectionId {
	let active: SheetSectionId = tops[0]?.id ?? "access";
	for (const section of tops) {
		if (section.top <= line) {
			active = section.id;
		}
	}
	return active;
}
