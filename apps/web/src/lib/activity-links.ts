import {
	FORGE_BY_ID,
	type ForgeId,
	type NormalizedEvent,
} from "@tripwire/contracts";

export interface ForgeLink {
	href: string;
	label: string;
}

export function forgeLabel(forge: ForgeId): string {
	return FORGE_BY_ID[forge]?.label ?? forge;
}

function eventForgeSubject(event: NormalizedEvent): string | null {
	if ("changeRequest" in event) {
		return `#${event.changeRequest.number}`;
	}
	if (event.kind === "comment.created") {
		return `the comment on #${event.comment.subjectNumber}`;
	}
	if (event.kind === "push") {
		return `the push to ${event.push.ref.replace("refs/heads/", "")}`;
	}
	if (event.kind === "schedule.matched") {
		return `#${event.thread.number}`;
	}
	return null;
}

function eventForgeUrl(event: NormalizedEvent): string | null {
	if ("changeRequest" in event) {
		return event.changeRequest.url;
	}
	if (event.kind === "comment.created") {
		return event.comment.url;
	}
	if (event.kind === "push") {
		return event.push.url ?? null;
	}
	if (event.kind === "schedule.matched") {
		return event.thread.url;
	}
	return null;
}

export function eventForgeLink(event: NormalizedEvent): ForgeLink | null {
	const href = eventForgeUrl(event);
	const subject = eventForgeSubject(event);
	if (!(href && subject)) {
		return null;
	}
	return { href, label: `Open ${subject} on ${forgeLabel(event.forge)}` };
}

export function changeRequestForgeLink(
	forge: ForgeId,
	number: number,
	url: string | null,
): ForgeLink | null {
	if (!url) {
		return null;
	}
	return { href: url, label: `Open #${number} on ${forgeLabel(forge)}` };
}
