import type { RedactionItem, RedactionSurface } from "@tripwire/contracts";
import {
	REDACTION_MAJOR_LEVELS,
	REDACTION_MAX_LEVEL,
	REDACTION_SURFACES,
} from "@tripwire/contracts";

export const REDACTION_STEPS: readonly number[] = Array.from(
	{ length: REDACTION_MAX_LEVEL + 1 },
	(_, level) => level,
);

export const REDACTION_MAJOR_STEPS: readonly number[] = REDACTION_MAJOR_LEVELS;

export const REDACTION_STOP_NAMES = [
	"Nothing hidden",
	"Matched values hidden",
	"File paths hidden",
	"Evidence hidden",
	"AI summary hidden",
	"Reasons hidden",
	"Rule names hidden",
	"Passed count hidden",
	"Verdict only",
] as const satisfies readonly string[];

export const REDACTION_ITEM_LABELS = {
	"matched-values": "Matched values",
	"file-paths": "File paths",
	"ai-trace": "AI trace",
	"ai-summary": "AI summary",
	reasons: "Why each rule failed",
	"rule-names": "Which rules ran",
	"passed-count": "Passed count",
	"failed-count": "Failed count",
} as const satisfies Record<RedactionItem, string>;

export const REDACTION_SURFACE_LABELS = {
	"run-page": "Run page",
	check: "Check run",
	comment: "Comment",
	review: "Review",
	webhook: "Discord and webhooks",
} as const satisfies Record<RedactionSurface, string>;

export function stopName(level: number): string {
	return REDACTION_STOP_NAMES[level] ?? REDACTION_STOP_NAMES[0];
}

export function toggleSurface(
	surfaces: readonly RedactionSurface[],
	surface: RedactionSurface,
	on: boolean,
): RedactionSurface[] {
	return REDACTION_SURFACES.filter((candidate) =>
		candidate === surface ? on : surfaces.includes(candidate),
	);
}

export function orderedSurfaces(
	surfaces: readonly RedactionSurface[],
): RedactionSurface[] {
	return REDACTION_SURFACES.filter((surface) => surfaces.includes(surface));
}

export function sameSurfaces(
	a: readonly RedactionSurface[],
	b: readonly RedactionSurface[],
): boolean {
	const left = orderedSurfaces(a);
	const right = orderedSurfaces(b);
	return (
		left.length === right.length &&
		left.every((surface, index) => surface === right[index])
	);
}

export function encodeSurfaces(surfaces: readonly RedactionSurface[]): string {
	return orderedSurfaces(surfaces).join(",");
}

export function decodeSurfaces(encoded: string): RedactionSurface[] {
	const listed = new Set(encoded.split(","));
	return REDACTION_SURFACES.filter((surface) => listed.has(surface));
}
