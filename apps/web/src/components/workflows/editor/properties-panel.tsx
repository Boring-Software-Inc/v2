import type {
	EventKind,
	GateMode,
	JsonValue,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	TRIGGER_CATALOG,
} from "@tripwire/contracts";
import { useState } from "react";
import {
	type FieldSpec,
	fieldsForSchema,
	ruleCatalogEntryForRef,
} from "#/components/workflows/editor/node-fields";
import { cn } from "#/lib/utils";

/**
 * Schema-driven properties for the selected node — rule editors are DERIVED
 * from RULE_CATALOG configSchema shapes via the shared walk in node-fields.ts
 * (the SAME source the node face's inline summaries read), so a new rule gets
 * a form without touching this file. No bespoke per-rule forms, ever.
 */

/** Does the properties tab have anything to edit for this node? */
export function hasEditableParams(node: WorkflowNode): boolean {
	switch (node.type) {
		case "trigger":
		case "gate":
			return true;
		case "rule": {
			const entry = ruleCatalogEntryForRef(node.ref);
			return (fieldsForSchema(entry?.configSchema)?.length ?? 0) > 0;
		}
		case "action":
			return (
				node.action === "label" ||
				node.action === "webhook" ||
				node.action === "discord"
			);
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
	onTestConnection?: (
		url: string,
		kind: "webhook" | "discord",
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
}

export function PropertiesPanel({
	node,
	readOnly,
	onUpdate,
	onTestConnection,
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
				<ActionFields
					node={node}
					onTestConnection={onTestConnection}
					onUpdate={onUpdate}
					readOnly={readOnly}
				/>
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
	const entry = ruleCatalogEntryForRef(node.ref);
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
	onTestConnection,
}: {
	node: Extract<WorkflowNode, { type: "action" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
	onTestConnection?: (
		url: string,
		kind: "webhook" | "discord",
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
}) {
	if (node.action === "webhook" || node.action === "discord") {
		return (
			<DeliveryFields
				node={node}
				onTestConnection={onTestConnection}
				onUpdate={onUpdate}
				readOnly={readOnly}
			/>
		);
	}
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

/**
 * A webhook node pointed at a Discord url silently 400s forever (Discord wants
 * its own message shape, not our raw json). Detect it so the panel can steer
 * the user to the discord node — warn, never block, since the url is valid.
 */
function looksLikeDiscordUrl(raw: string): boolean {
	try {
		const host = new URL(raw).host.toLowerCase();
		return (
			host === "discord.com" ||
			host === "discordapp.com" ||
			host === "ptb.discord.com" ||
			host === "canary.discord.com"
		);
	} catch {
		return false;
	}
}

/**
 * Webhook + Discord config. Secrets arrive masked (blank value + a `*Set`
 * marker): a set field shows a "leave blank to keep" placeholder, a blank save
 * keeps the stored value, a typed value replaces it. The full secret never
 * round-trips to the client.
 */
function DeliveryFields({
	node,
	readOnly,
	onUpdate,
	onTestConnection,
}: {
	node: Extract<WorkflowNode, { type: "action" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
	onTestConnection?: (
		url: string,
		kind: "webhook" | "discord",
	) => Promise<{ ok: boolean; status?: number; failure?: string }>;
}) {
	const params = (node.params ?? {}) as Record<string, JsonValue>;
	const setParam = (key: string, value: string) =>
		onUpdate({ ...node, params: { ...params, [key]: value } });
	const urlSet = params.urlSet === true;
	const secretSet = params.signingSecretSet === true;
	const url = typeof params.url === "string" ? params.url : "";
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{
		ok: boolean;
		failure?: string;
	} | null>(null);
	const runTest = async () => {
		if (!onTestConnection || url === "") {
			return;
		}
		setTesting(true);
		setTestResult(null);
		try {
			setTestResult(
				await onTestConnection(url, node.action as "webhook" | "discord"),
			);
		} finally {
			setTesting(false);
		}
	};
	return (
		<div className="flex flex-col gap-3">
			<div>
				<label className={LABEL_CLASS} htmlFor="delivery-url">
					{node.action === "discord" ? "discord webhook url" : "webhook url"}
				</label>
				<input
					className={INPUT_CLASS}
					disabled={readOnly}
					id="delivery-url"
					onChange={(event) => {
						setParam("url", event.target.value);
						setTestResult(null);
					}}
					placeholder={urlSet ? "set — leave blank to keep" : "https://..."}
					type="url"
					value={url}
				/>
				<p className="mt-1 text-[11px] text-muted-foreground">
					https only. private and internal addresses are refused.
				</p>
				{node.action === "webhook" && looksLikeDiscordUrl(url) ? (
					<p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
						this looks like a discord url. use a discord node instead — a
						webhook node sends raw json that discord rejects.
					</p>
				) : null}
				<div className="mt-1.5 flex items-center gap-2">
					<button
						className="rounded-md bg-surface-1 px-2 py-1 font-medium text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
						disabled={readOnly || testing || url === ""}
						onClick={runTest}
						type="button"
					>
						{testing ? "testing…" : "test connection"}
					</button>
					{testResult ? (
						<span
							className={cn(
								"text-[11px]",
								testResult.ok
									? "text-emerald-600 dark:text-emerald-400"
									: "text-red-600 dark:text-red-400",
							)}
						>
							{testResult.ok
								? "reached"
								: `failed: ${testResult.failure ?? "unknown"}`}
						</span>
					) : null}
				</div>
			</div>
			{node.action === "webhook" ? (
				<div>
					<label className={LABEL_CLASS} htmlFor="delivery-secret">
						signing secret (optional)
					</label>
					<input
						className={INPUT_CLASS}
						disabled={readOnly}
						id="delivery-secret"
						onChange={(event) => setParam("signingSecret", event.target.value)}
						placeholder={secretSet ? "set — leave blank to keep" : "optional"}
						type="password"
						value={
							typeof params.signingSecret === "string"
								? params.signingSecret
								: ""
						}
					/>
					<p className="mt-1 text-[11px] text-muted-foreground">
						signs each post so your receiver can verify it came from tripwire.
					</p>
				</div>
			) : null}
			<p className="text-[11px] text-muted-foreground">
				{
					ACTION_CATALOG.find((entry) => entry.action === node.action)
						?.description
				}
			</p>
		</div>
	);
}
