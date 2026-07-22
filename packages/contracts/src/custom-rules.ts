import { z } from "zod";
import { RULE_CATALOG, type RuleCatalogEntry } from "./rules.ts";

/**
 * Custom rules: rules defined in DATA instead of code. The stored definition
 * IS the serialized SDK shape ({ when, comparison, severity }); a row
 * deserializes directly to what evaluateSignalRule takes. Registration is a
 * loader that synthesizes a catalog entry; built-ins keep defineRule. Two
 * registration paths, one catalog: every consumer reads both identically.
 */

/** v1 comparison verbs safe for stored rules. No user regex (matches, scan)
 * until the RE2 gate; noneMatch is plain globs, the honeypot trust level. */
export const CUSTOM_COMPARISON_KINDS = [
	"under",
	"over",
	"atLeast",
	"atMost",
	"between",
	"equals",
	"not",
	"oneOf",
	"noneOf",
	"has",
	"noneMatch",
] as const;

const windowSchema = z
	.string()
	.regex(/^\d+(h|d)$/, "window must be a count and a unit, like 24h or 7d");

const transformSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("last"), window: windowSchema }),
	z.object({ kind: z.literal("lastCount"), window: windowSchema }),
	z.object({ kind: z.literal("trimmedLength") }),
	z.object({ kind: z.literal("nonLatinRatio") }),
	z.object({ kind: z.literal("letterCount") }),
]);

const scalarArgSchema = z.union([z.number(), z.string(), z.boolean()]);
const argSchema = z.union([
	scalarArgSchema,
	z.array(z.union([z.number(), z.string()])),
]);

const baseComparisonSchema = z.object({
	kind: z.enum(CUSTOM_COMPARISON_KINDS),
	args: z.array(argSchema),
});

/** `not` nests exactly one inner comparison; anything deeper is rejected. */
export const customComparisonSchema = z.union([
	baseComparisonSchema.refine((c) => c.kind !== "not", {
		message: "not takes an inner comparison",
	}),
	z.object({
		kind: z.literal("not"),
		args: z.tuple([baseComparisonSchema]),
	}),
]);

export const customRuleDefinitionSchema = z.object({
	when: z.object({
		id: z.string().min(1),
		transform: transformSchema.optional(),
	}),
	comparison: customComparisonSchema,
	severity: z.enum(["low", "medium", "high"]),
});
export type CustomRuleDefinition = z.infer<typeof customRuleDefinitionSchema>;

export const CUSTOM_RULE_PREFIX = "custom-";

export function isCustomRuleId(ruleId: string): boolean {
	return ruleId.startsWith(CUSTOM_RULE_PREFIX);
}

/** Custom rules are always version 1 in v1; edits update in place. */
export function customRuleRef(ruleId: string): string {
	return `${ruleId}@1`;
}

export const customRuleRecordSchema = z.object({
	/** Globally unique, "custom-" prefixed, so it can never collide with a
	 * built-in id and every ref keeps the id@version grammar. */
	id: z
		.string()
		.regex(/^custom-[a-z0-9][a-z0-9-]*$/, "id must be custom-<kebab-slug>"),
	name: z.string().min(1).max(80),
	enabled: z.boolean(),
	definition: customRuleDefinitionSchema,
});
export type CustomRuleRecord = z.infer<typeof customRuleRecordSchema>;

/**
 * A catalog entry as every consumer reads it, from either registration
 * path. `source` is presentation and lifecycle (the custom tag, delete
 * allowed); nothing reads it to decide behavior.
 */
export interface ResolvedCatalogEntry {
	ruleId: string;
	version: number;
	name: string;
	blurb: string;
	description: string;
	configSchema: z.ZodType;
	defaultConfig: unknown;
	optIn: boolean;
	contributorLabel: string;
	changeNote?: string;
	source: "built-in" | "custom";
	/** The stored definition, carried so the builder can reopen it. */
	custom?: CustomRuleDefinition;
}

/** A custom rule has no config: the rule IS the config. */
const EMPTY_CONFIG_SCHEMA = z.object({});

/** The loader: one stored row becomes one catalog entry. */
export function customCatalogEntry(
	record: CustomRuleRecord,
): ResolvedCatalogEntry {
	return {
		ruleId: record.id,
		version: 1,
		name: record.name,
		blurb: `custom rule for this repo: ${record.name}.`,
		description: "A rule this repo authored from its signals.",
		configSchema: EMPTY_CONFIG_SCHEMA,
		defaultConfig: {},
		optIn: true,
		contributorLabel: "this change didn't meet one of this repo's rules.",
		source: "custom",
		custom: record.definition,
	};
}

/**
 * The runtime catalog: built-ins plus the repo's custom rules, merged at
 * read time. This is what consumers resolve against instead of the static
 * constant when a repo is in scope.
 */
export function resolveCatalog(
	customRules: readonly CustomRuleRecord[],
): ResolvedCatalogEntry[] {
	const builtIns = RULE_CATALOG.map(
		(entry: RuleCatalogEntry): ResolvedCatalogEntry => ({
			ruleId: entry.ruleId,
			version: entry.version,
			name: entry.name,
			blurb: entry.blurb,
			description: entry.description,
			configSchema: entry.configSchema,
			defaultConfig: entry.defaultConfig,
			optIn: entry.optIn,
			contributorLabel: entry.contributorLabel,
			...("changeNote" in entry ? { changeNote: entry.changeNote } : {}),
			source: "built-in",
		}),
	);
	return [...builtIns, ...customRules.map(customCatalogEntry)];
}
