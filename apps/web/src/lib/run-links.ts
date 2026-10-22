import {
	type EventKind,
	eventKindSchema,
	type ForgeId,
	type Verdict,
	verdictSchema,
} from "@tripwire/contracts";
import { z } from "zod";
import type {
	JsonValue,
	RunEventView,
	RunLinkView,
} from "#/lib/runs.functions";

const GITHUB = "https://github.com";

export function actionUrl(input: {
	forge: ForgeId | null;
	repoFullName: string;
	number: number | null;
	kind: string;
	externalId: string | null;
}): string | null {
	const { forge, repoFullName, number, kind, externalId } = input;
	if (forge !== "github" || !externalId) {
		return null;
	}
	if (kind === "set-check") {
		return `${GITHUB}/${repoFullName}/runs/${externalId}`;
	}
	if (number === null) {
		return null;
	}
	if (kind === "block") {
		return `${GITHUB}/${repoFullName}/pull/${number}#pullrequestreview-${externalId}`;
	}
	if (kind === "comment") {
		return `${GITHUB}/${repoFullName}/pull/${number}#issuecomment-${externalId}`;
	}
	return null;
}

function eventKind(kind: string | null): EventKind | null {
	const parsed = eventKindSchema.safeParse(kind);
	return parsed.success ? parsed.data : null;
}

function runVerdict(verdict: string | null): Verdict | null {
	const parsed = verdictSchema.safeParse(verdict);
	return parsed.success ? parsed.data : null;
}

const normalizedShape = z
	.object({
		occurredAt: z.string().optional(),
		changeRequest: z.object({ title: z.string() }).optional(),
	})
	.catch({});

export function toEventView(row: {
	kind: string | null;
	actorLogin: string | null;
	headSha: string | null;
	normalized: JsonValue;
	receivedAt: Date;
}): RunEventView {
	const normalized = normalizedShape.parse(row.normalized);
	return {
		kind: eventKind(row.kind),
		actor: row.actorLogin,
		title: normalized.changeRequest?.title ?? null,
		headSha: row.headSha,
		at: normalized.occurredAt ?? row.receivedAt.toISOString(),
	};
}

export function runLink(row: {
	id: string;
	status: string;
	verdict: string | null;
	headSha: string | null;
	triggeredBy: string | null;
	createdAt: Date;
	eventKind: string | null;
	actorLogin: string | null;
}): RunLinkView {
	return {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		status: row.status,
		verdict: runVerdict(row.verdict),
		eventKind: eventKind(row.eventKind),
		actor: row.actorLogin,
		headSha: row.headSha,
		rerun: row.triggeredBy !== null,
	};
}
