import type { JsonValue, WorkflowNode } from "@tripwire/contracts";
import {
	appliesToValue,
	describeDuration,
	describeSchedule,
	isScheduleTrigger,
	jsonValueSchema,
	RULE_CATALOG,
	ruleUiSchema,
	storedReviewerSchema,
} from "@tripwire/contracts";
import { z } from "zod";
import { whenSentence } from "#/lib/trigger-kinds";

const targetList = z.array(z.string()).catch([]);
const stringItems = z
	.array(z.string().optional().catch(undefined))
	.catch([])
	.transform((items) => items.filter((item) => item !== undefined));
const optionalText = z.string().optional().catch(undefined);
const jsonRecord = z.record(z.string(), jsonValueSchema);

/** Array drafts retain numeric keys when a field edit spreads the config. */
export const ruleConfigFieldsSchema = z
	.union([
		jsonRecord,
		z
			.array(jsonValueSchema)
			.transform((items) =>
				Object.fromEntries(items.map((value, index) => [String(index), value])),
			),
	])
	.catch({});
const reviewerList = z
	.array(storedReviewerSchema.optional().catch(undefined))
	.catch([]);

/**
 * THE schema-to-fields source: one zod walk feeding BOTH the properties
 * panel's editors and the node face's inline summaries. Moved here from
 * properties-panel.tsx so there is never a second hand-maintained field list —
 * if a config schema gains a field, the panel and the node face both grow it
 * from this walk.
 */

interface FieldBase {
	key: string;
	label: string;
	/**
	 * Marked via zod `.meta({ secret: true })` on the schema field. DISPLAY
	 * masking ONLY: summaries render dots instead of the value. This is not
	 * storage security — encryption at rest and log hygiene are the owning
	 * feature's separate concern (e.g. webhook URLs).
	 */
	secret: boolean;
}

export type FieldSpec = FieldBase &
	(
		| { kind: "number"; min?: number; max?: number; int: boolean }
		| { kind: "string" }
		| { kind: "boolean" }
		| { kind: "enum"; options: (string | number)[] }
		| { kind: "string-list" }
		| { kind: "json" }
	);

/** Peel default/optional wrappers to the type that decides the editor. */
function unwrapField(schema: z.core.$ZodType): z.core.$ZodType {
	let current = schema;
	while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
		current = current.unwrap();
	}
	return current;
}

function numberBounds(schema: z.ZodNumber) {
	let min: number | undefined;
	let max: number | undefined;
	let int = false;
	for (const check of schema._zod.def.checks ?? []) {
		if (check instanceof z.core.$ZodCheckGreaterThan) {
			const value = z.number().safeParse(check._zod.def.value);
			if (value.success) {
				min = value.data;
			}
		}
		if (check instanceof z.core.$ZodCheckLessThan) {
			const value = z.number().safeParse(check._zod.def.value);
			if (value.success) {
				max = value.data;
			}
		}
		if (
			check instanceof z.core.$ZodCheckNumberFormat &&
			check._zod.def.format === "safeint"
		) {
			int = true;
		}
	}
	return { min, max, int };
}

/** Walk a config schema's shape into renderable field specs. */
export function fieldsForSchema(
	schema: z.ZodType | undefined,
): FieldSpec[] | null {
	if (!(schema instanceof z.ZodObject)) {
		return null;
	}
	return Object.entries(schema.shape).map(([key, field]) => {
		const meta = z.globalRegistry.get(field);
		const label = meta?.description ?? key;
		const secret = meta?.secret === true;
		const inner = unwrapField(field);
		if (inner instanceof z.ZodNumber) {
			return {
				key,
				label,
				secret,
				kind: "number" as const,
				...numberBounds(inner),
			};
		}
		if (inner instanceof z.ZodBoolean) {
			return { key, label, secret, kind: "boolean" as const };
		}
		if (inner instanceof z.ZodEnum) {
			return {
				key,
				label,
				secret,
				kind: "enum" as const,
				options: inner.options,
			};
		}
		if (inner instanceof z.ZodArray) {
			if (unwrapField(inner.element) instanceof z.ZodString) {
				return { key, label, secret, kind: "string-list" as const };
			}
			return { key, label, secret, kind: "json" as const };
		}
		if (inner instanceof z.ZodString) {
			return { key, label, secret, kind: "string" as const };
		}
		return { key, label, secret, kind: "json" as const };
	});
}

/** Version-exact catalog lookup for a rule ref (`account-age@1`). */
export function ruleCatalogEntryForRef(ref: string) {
	const [ruleId, versionRaw] = ref.split("@");
	return RULE_CATALOG.find(
		(entry) => entry.ruleId === ruleId && entry.version === Number(versionRaw),
	);
}

export interface NodeFieldValue {
	field: FieldSpec;
	value: JsonValue | undefined;
}

/**
 * The node face's inline rows: [field, current value] pairs from the SAME
 * walk the panel edits with. Rule labels prefer the readable-params layer
 * (contracts RULE_PARAMS — short display labels) over the schema's long
 * `.describe()` sentences; the FIELD SET itself always comes from the schema
 * walk, so the two surfaces cannot drift on which fields exist. Empty array
 * = a binary node; the face renders no body.
 */
export function nodeFieldValues(node: WorkflowNode): NodeFieldValue[] {
	switch (node.type) {
		case "rule": {
			const entry = ruleCatalogEntryForRef(node.ref);
			const fields = fieldsForSchema(entry?.configSchema) ?? [];
			const params = ruleUiSchema(node.ref)?.params;
			const config = ruleConfigFieldsSchema.parse(node.config);
			return fields.map((field) => ({
				field: {
					...field,
					label:
						params?.find((param) => param.key === field.key)?.label ??
						field.label,
				},
				value: config[field.key],
			}));
		}
		case "trigger": {
			const row = (key: string, label: string, value: string | null) => ({
				field: { key, label, secret: false, kind: "string" as const },
				value: value ?? undefined,
			});
			if (!isScheduleTrigger(node)) {
				return [row("kinds", "When", whenSentence(node.kinds))];
			}
			const draft = node.schedule;
			const rows: NodeFieldValue[] = [
				row(
					"every",
					"Runs",
					draft?.every
						? describeSchedule({ every: draft.every, timezone: draft.timezone })
						: null,
				),
				row(
					"subjects",
					"Applies to",
					appliesToValue(draft?.match.subjects, draft?.match.state),
				),
				row(
					"inactiveFor",
					"Inactive for",
					draft?.match.inactiveFor
						? describeDuration(draft.match.inactiveFor)
						: null,
				),
			];
			const labelRow = (key: string, label: string, labels: string[]) => ({
				field: { key, label, secret: false, kind: "string-list" as const },
				value: labels,
			});
			if (draft?.match.labels?.length) {
				rows.push(labelRow("labels", "With labels", draft.match.labels));
			}
			if (draft?.match.excludeLabels?.length) {
				rows.push(
					labelRow(
						"excludeLabels",
						"Without labels",
						draft.match.excludeLabels,
					),
				);
			}
			return rows;
		}
		case "action": {
			if (node.action === "label" || node.action === "remove-label") {
				const labels = stringItems.parse(node.params?.labels);
				return [
					{
						field: {
							key: "labels",
							label: node.action === "label" ? "Adds" : "Removes",
							secret: false,
							kind: "string-list",
						},
						value: labels,
					},
				];
			}
			if (node.action === "request-review") {
				const people = reviewerList
					.parse(node.params?.reviewers)
					.flatMap((reviewer) => (reviewer ? [reviewer.login] : []));
				const teams = targetList.parse(node.params?.teamReviewers);
				const rows: NodeFieldValue[] = [
					{
						field: {
							key: "reviewers",
							label: "Reviewers",
							secret: false,
							kind: people.length > 0 ? "string-list" : "string",
						},
						value: people.length > 0 ? people : undefined,
					},
				];
				if (teams.length > 0) {
					rows.push({
						field: {
							key: "teamReviewers",
							label: "Teams",
							secret: false,
							kind: "string-list",
						},
						value: teams,
					});
				}
				return rows;
			}
			if (node.action === "post-comment") {
				const message = optionalText.parse(node.params?.message);
				return [
					{
						field: {
							key: "message",
							label: "Message",
							secret: false,
							kind: "string",
						},
						value:
							message !== undefined && message.trim() !== ""
								? message
								: undefined,
					},
				];
			}
			if (node.action === "lock") {
				const reason = optionalText.parse(node.params?.reason);
				return [
					{
						field: {
							key: "reason",
							label: "Reason",
							secret: false,
							kind: "string",
						},
						value:
							reason !== undefined
								? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`
								: "None",
					},
				];
			}
			if (node.action === "webhook" || node.action === "discord") {
				const params = node.params ?? {};
				const rows: NodeFieldValue[] = [
					{
						field: { key: "url", label: "URL", secret: true, kind: "string" },
						value: optionalText.parse(params.url),
					},
				];
				if (node.action === "webhook" && params.signingSecret) {
					rows.push({
						field: {
							key: "signingSecret",
							label: "Signing secret",
							secret: true,
							kind: "string",
						},
						value: "set",
					});
				}
				return rows;
			}
			return [];
		}
		default:
			return [];
	}
}

const MASK = "••••••••";

/** Compact per-type value summary for the node face. */
const labelListSchema = z.array(z.string());

export function fieldListItems(
	field: FieldSpec,
	value: JsonValue | undefined,
): string[] | null {
	const items = labelListSchema.safeParse(value);
	if (field.kind !== "string-list" || field.secret || !items.success) {
		return null;
	}
	const unique = [...new Set(items.data)];
	return unique.length > 0 ? unique : null;
}

export function summarizeFieldValue(
	field: FieldSpec,
	value: JsonValue | undefined,
): string {
	if (field.secret) {
		return MASK;
	}
	if (value === undefined || value === null) {
		return "Not set";
	}
	switch (field.kind) {
		case "boolean":
			return value === true ? "on" : "off";
		case "string-list": {
			const items = stringItems.parse(value);
			if (items.length === 0) {
				return "none";
			}
			return items.join(", ");
		}
		case "json": {
			if (Array.isArray(value)) {
				return value.length === 0 ? "none" : `${value.length} items`;
			}
			const object = jsonRecord.safeParse(value);
			if (object.success) {
				const keys = Object.keys(object.data);
				if (keys.length === 0) {
					return "empty";
				}
				const shown = keys.slice(0, 2).join(", ");
				return keys.length > 2 ? `${shown} +${keys.length - 2}` : shown;
			}
			return String(value);
		}
		default:
			return String(value);
	}
}
