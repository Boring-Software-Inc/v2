import { z } from "zod";

export const REDACTION_ITEMS = [
	"matched-values",
	"file-paths",
	"ai-trace",
	"ai-summary",
	"reasons",
	"rule-names",
	"passed-count",
	"failed-count",
] as const;
export type RedactionItem = (typeof REDACTION_ITEMS)[number];

export const REDACTION_MAX_LEVEL = REDACTION_ITEMS.length;
export const REDACTION_MAJOR_LEVELS = [0, 3, 5, 6, 8] as const;

export const redactionLevelSchema = z
	.number()
	.int()
	.min(0)
	.max(REDACTION_MAX_LEVEL);

export const redactionSurfaceSchema = z.enum([
	"run-page",
	"check",
	"comment",
	"review",
	"webhook",
]);
export type RedactionSurface = z.infer<typeof redactionSurfaceSchema>;

export const REDACTION_SURFACES = redactionSurfaceSchema.options;

export const DEFAULT_REDACTION_SURFACES: readonly RedactionSurface[] = [
	"run-page",
	"check",
	"comment",
	"review",
];

export const redactionPolicySchema = z.object({
	level: redactionLevelSchema.default(0),
	surfaces: z
		.array(redactionSurfaceSchema)
		.default(() => [...DEFAULT_REDACTION_SURFACES]),
	showHelp: z.boolean().default(true),
});
export type RedactionPolicy = z.infer<typeof redactionPolicySchema>;

export const repoRedactionSchema = redactionPolicySchema.extend({
	inherit: z.boolean().default(true),
});
export type RepoRedaction = z.infer<typeof repoRedactionSchema>;

export const OPEN_REDACTION: RedactionPolicy = redactionPolicySchema.parse({});

export function resolveRedaction(
	repo: RepoRedaction,
	orgDefault: RedactionPolicy | null,
): RedactionPolicy {
	if (repo.inherit) {
		return orgDefault ?? OPEN_REDACTION;
	}
	const { inherit: _inherit, ...override } = repo;
	return override;
}

export function redactionLevelFor(
	policy: RedactionPolicy,
	surface: RedactionSurface,
): number {
	return policy.surfaces.includes(surface) ? policy.level : 0;
}

export function redactionHides(level: number, item: RedactionItem): boolean {
	return REDACTION_ITEMS.indexOf(item) < level;
}

export function hiddenRedactionItems(level: number): RedactionItem[] {
	return REDACTION_ITEMS.slice(0, Math.max(0, level));
}
