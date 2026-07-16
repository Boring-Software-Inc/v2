import type {
	EventKind,
	GateMode,
	JsonValue,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
	TRIGGER_CATALOG,
} from "@tripwire/contracts";
import { z } from "zod";

/**
 * Schema-driven properties for the selected node — rule editors are DERIVED
 * from RULE_CATALOG configSchema shapes (zod v4 instanceof introspection), so
 * a new rule gets a form without touching this file. No bespoke per-rule
 * forms, ever.
 */

type FieldSpec =
	| {
			key: string;
			label: string;
			kind: "number";
			min?: number;
			max?: number;
			int: boolean;
	  }
	| { key: string; label: string; kind: "string" }
	| { key: string; label: string; kind: "boolean" }
	| { key: string; label: string; kind: "enum"; options: string[] }
	| { key: string; label: string; kind: "string-list" }
	| { key: string; label: string; kind: "json" };

/** Peel default/optional wrappers to the type that decides the editor. */
function unwrapField(schema: z.ZodType): z.ZodType {
	let current = schema;
	while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
		current = current.unwrap() as z.ZodType;
	}
	return current;
}

function numberBounds(schema: z.ZodNumber): {
	min?: number;
	max?: number;
	int: boolean;
} {
	const def = schema._zod.def as { checks?: unknown[] };
	let min: number | undefined;
	let max: number | undefined;
	let int = false;
	for (const check of def.checks ?? []) {
		const c = (check as { _zod: { def: Record<string, unknown> } })._zod.def;
		if (c.check === "greater_than" && typeof c.value === "number") {
			min = c.value;
		}
		if (c.check === "less_than" && typeof c.value === "number") {
			max = c.value;
		}
		if (c.check === "number_format" && c.format === "safeint") {
			int = true;
		}
	}
	return { min, max, int };
}

/** Walk a config schema's shape into renderable field specs. */
function fieldsForSchema(schema: unknown): FieldSpec[] | null {
	if (!(schema instanceof z.ZodObject)) {
		return null;
	}
	return Object.entries(schema.shape as Record<string, unknown>).map(
		([key, raw]) => {
			const field = raw as z.ZodType;
			const label = field.description ?? key;
			const inner = unwrapField(field);
			if (inner instanceof z.ZodNumber) {
				return { key, label, kind: "number" as const, ...numberBounds(inner) };
			}
			if (inner instanceof z.ZodBoolean) {
				return { key, label, kind: "boolean" as const };
			}
			if (inner instanceof z.ZodEnum) {
				return {
					key,
					label,
					kind: "enum" as const,
					options: inner.options as string[],
				};
			}
			if (inner instanceof z.ZodArray) {
				if (unwrapField(inner.element as z.ZodType) instanceof z.ZodString) {
					return { key, label, kind: "string-list" as const };
				}
				return { key, label, kind: "json" as const };
			}
			if (inner instanceof z.ZodString) {
				return { key, label, kind: "string" as const };
			}
			return { key, label, kind: "json" as const };
		},
	);
}

function ruleCatalogEntry(ref: string) {
	const [ruleId, versionRaw] = ref.split("@");
	return RULE_CATALOG.find(
		(entry) => entry.ruleId === ruleId && entry.version === Number(versionRaw),
	);
}

/** Does the properties tab have anything to edit for this node? */
export function hasEditableParams(node: WorkflowNode): boolean {
	switch (node.type) {
		case "trigger":
		case "gate":
			return true;
		case "rule": {
			const entry = ruleCatalogEntry(node.ref);
			return (fieldsForSchema(entry?.configSchema)?.length ?? 0) > 0;
		}
		case "action":
			return node.action === "label";
		default:
			return false;
	}
}

const INPUT_CLASS =
	"w-full rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50";
const LABEL_CLASS = "mb-1 block text-[11px] text-muted-foreground";

export interface PropertiesPanelProps {
	node: WorkflowNode;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}

export function PropertiesPanel({
	node,
	readOnly,
	onUpdate,
}: PropertiesPanelProps) {
	switch (node.type) {
		case "trigger":
			return (
				<TriggerFields node={node} onUpdate={onUpdate} readOnly={readOnly} />
			);
		case "rule":
			return <RuleFields node={node} onUpdate={onUpdate} readOnly={readOnly} />;
		case "gate":
			return <GateFields node={node} onUpdate={onUpdate} readOnly={readOnly} />;
		case "action":
			return (
				<ActionFields node={node} onUpdate={onUpdate} readOnly={readOnly} />
			);
		default:
			return null;
	}
}

function TriggerFields({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "trigger" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	const toggle = (kind: EventKind, checked: boolean) => {
		const kinds = checked
			? [...node.kinds, kind]
			: node.kinds.filter((k) => k !== kind);
		onUpdate({ ...node, kinds });
	};
	return (
		<div className="flex flex-col gap-1.5">
			<p className="text-[11px] text-muted-foreground">
				runs on these events (pick at least one)
			</p>
			{TRIGGER_CATALOG.filter((entry) => entry.toolbox).map((entry) => (
				<label
					className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-surface-1"
					key={entry.kind}
				>
					<input
						checked={node.kinds.includes(entry.kind)}
						className="accent-brand"
						disabled={readOnly}
						onChange={(event) => toggle(entry.kind, event.target.checked)}
						type="checkbox"
					/>
					{entry.name}
				</label>
			))}
		</div>
	);
}

function RuleFields({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "rule" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	const entry = ruleCatalogEntry(node.ref);
	if (!entry) {
		return (
			<p className="text-muted-foreground text-xs">
				unknown rule <span className="font-mono">{node.ref}</span> — not in the
				catalog.
			</p>
		);
	}
	const fields = fieldsForSchema(entry.configSchema) ?? [];
	if (fields.length === 0) {
		return <p className="text-muted-foreground text-xs">no options.</p>;
	}
	const config = (
		typeof node.config === "object" && node.config !== null ? node.config : {}
	) as Record<string, JsonValue>;
	const setField = (key: string, value: JsonValue) => {
		onUpdate({ ...node, config: { ...config, [key]: value } });
	};
	return (
		<div className="flex flex-col gap-3">
			<p className="text-[11px] text-muted-foreground">{entry.blurb}</p>
			{fields.map((field) => (
				<ConfigField
					field={field}
					key={field.key}
					onChange={(value) => setField(field.key, value)}
					readOnly={readOnly}
					value={config[field.key]}
				/>
			))}
		</div>
	);
}

function ConfigField({
	field,
	value,
	readOnly,
	onChange,
}: {
	field: FieldSpec;
	value: JsonValue | undefined;
	readOnly: boolean;
	onChange: (value: JsonValue) => void;
}) {
	switch (field.kind) {
		case "number":
			return (
				<div>
					<label className={LABEL_CLASS} htmlFor={`field-${field.key}`}>
						{field.label}
					</label>
					<input
						className={INPUT_CLASS}
						disabled={readOnly}
						id={`field-${field.key}`}
						max={field.max}
						min={field.min}
						onChange={(event) => {
							const next = event.target.valueAsNumber;
							onChange(Number.isNaN(next) ? 0 : next);
						}}
						step={field.int ? 1 : "any"}
						type="number"
						value={typeof value === "number" ? value : ""}
					/>
				</div>
			);
		case "boolean":
			return (
				<label className="flex cursor-pointer items-center gap-2 text-xs">
					<input
						checked={value === true}
						className="accent-brand"
						disabled={readOnly}
						onChange={(event) => onChange(event.target.checked)}
						type="checkbox"
					/>
					{field.label}
				</label>
			);
		case "enum":
			return (
				<div>
					<label className={LABEL_CLASS} htmlFor={`field-${field.key}`}>
						{field.label}
					</label>
					<select
						className={INPUT_CLASS}
						disabled={readOnly}
						id={`field-${field.key}`}
						onChange={(event) => onChange(event.target.value)}
						value={typeof value === "string" ? value : ""}
					>
						{field.options.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>
			);
		case "string-list":
			return (
				<div>
					<label className={LABEL_CLASS} htmlFor={`field-${field.key}`}>
						{field.label} (one per line)
					</label>
					{/* uncontrolled: normalizing on change would eat typed newlines */}
					<textarea
						className={INPUT_CLASS}
						defaultValue={
							Array.isArray(value)
								? value.filter((v) => typeof v === "string").join("\n")
								: ""
						}
						disabled={readOnly}
						id={`field-${field.key}`}
						onChange={(event) =>
							onChange(
								event.target.value
									.split(/[\n,]/)
									.map((part) => part.trim())
									.filter((part) => part.length > 0),
							)
						}
						rows={3}
					/>
				</div>
			);
		case "string":
			return (
				<div>
					<label className={LABEL_CLASS} htmlFor={`field-${field.key}`}>
						{field.label}
					</label>
					<input
						className={INPUT_CLASS}
						disabled={readOnly}
						id={`field-${field.key}`}
						onChange={(event) => onChange(event.target.value)}
						type="text"
						value={typeof value === "string" ? value : ""}
					/>
				</div>
			);
		case "json":
			// Fallback for shapes introspection can't name — raw JSON per field.
			return (
				<div>
					<label className={LABEL_CLASS} htmlFor={`field-${field.key}`}>
						{field.label} (json)
					</label>
					<textarea
						className={`${INPUT_CLASS} font-mono`}
						defaultValue={JSON.stringify(value ?? null, null, 2)}
						disabled={readOnly}
						id={`field-${field.key}`}
						onBlur={(event) => {
							try {
								onChange(JSON.parse(event.target.value) as JsonValue);
							} catch {
								// keep the previous value; validation flags bad config anyway
							}
						}}
						rows={3}
					/>
				</div>
			);
		default:
			return null;
	}
}

function GateFields({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "gate" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	return (
		<div>
			<label className={LABEL_CLASS} htmlFor="gate-mode">
				mode
			</label>
			<select
				className={INPUT_CLASS}
				disabled={readOnly}
				id="gate-mode"
				onChange={(event) =>
					onUpdate({ ...node, mode: event.target.value as GateMode })
				}
				value={node.mode}
			>
				{GATE_CATALOG.map((entry) => (
					<option key={entry.mode} value={entry.mode}>
						{entry.name}
					</option>
				))}
			</select>
			<p className="mt-1.5 text-[11px] text-muted-foreground">
				{GATE_CATALOG.find((entry) => entry.mode === node.mode)?.description}
			</p>
		</div>
	);
}

function ActionFields({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "action" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	if (node.action !== "label") {
		return <p className="text-muted-foreground text-xs">no options.</p>;
	}
	const labels = Array.isArray(node.params?.labels)
		? node.params.labels.filter((v) => typeof v === "string")
		: [];
	return (
		<div>
			<label className={LABEL_CLASS} htmlFor="action-labels">
				labels (comma or newline separated)
			</label>
			{/* uncontrolled: normalizing on change would eat typed newlines */}
			<textarea
				className={INPUT_CLASS}
				defaultValue={labels.join("\n")}
				disabled={readOnly}
				id="action-labels"
				onChange={(event) =>
					onUpdate({
						...node,
						params: {
							...node.params,
							labels: event.target.value
								.split(/[\n,]/)
								.map((part) => part.trim())
								.filter((part) => part.length > 0),
						},
					})
				}
				rows={3}
			/>
			<p className="mt-1.5 text-[11px] text-muted-foreground">
				{ACTION_CATALOG.find((entry) => entry.action === "label")?.description}
			</p>
		</div>
	);
}
