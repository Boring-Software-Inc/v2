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
import { z } from "zod";
import { Alert, AlertDescription } from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldLegend,
	FieldSet,
	Label,
} from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { NumberInput } from "#/components/glaze/ui/number-input";
import { Select } from "#/components/glaze/ui/select";
import { Status } from "#/components/glaze/ui/status";
import { Textarea } from "#/components/glaze/ui/textarea";
import {
	type FieldSpec,
	fieldsForSchema,
	ruleCatalogEntryForRef,
} from "#/components/workflows/editor/node-fields";
import { ReviewerPicker } from "#/components/workflows/editor/reviewer-picker";

const numberOrNull = z.number().nullable().catch(null);
const labelList = z.array(z.string().optional().catch(undefined)).catch([]);

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
				node.action === "request-review" ||
				node.action === "webhook" ||
				node.action === "discord"
			);
		default:
			return false;
	}
}

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
		<FieldSet className="gap-2" data-field="kinds" disabled={readOnly}>
			<FieldLegend variant="label">
				Runs on these events (pick at least one)
			</FieldLegend>
			{TRIGGER_CATALOG.filter((entry) => entry.toolbox).map((entry) => (
				<Label className="flex items-center gap-2" key={entry.kind}>
					<Checkbox
						checked={node.kinds.includes(entry.kind)}
						disabled={readOnly}
						onCheckedChange={(checked) => toggle(entry.kind, checked)}
					/>
					{entry.name}
				</Label>
			))}
		</FieldSet>
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
			<p className="type-body-sm text-text-2">
				Unknown rule <span className="mono">{node.ref}</span>. It is not in the
				catalog.
			</p>
		);
	}
	const fields = fieldsForSchema(entry.configSchema) ?? [];
	if (fields.length === 0) {
		return (
			<p className="type-body-sm text-text-2">
				This rule has no settings to change.
			</p>
		);
	}
	const config = (
		typeof node.config === "object" && node.config !== null ? node.config : {}
	) as Record<string, JsonValue>;
	const setField = (key: string, value: JsonValue) => {
		onUpdate({ ...node, config: { ...config, [key]: value } });
	};
	return (
		<div className="flex flex-col gap-3">
			<p className="type-body-sm text-text-2">{entry.blurb}</p>
			{fields.map((field) => (
				<div data-field={field.key} key={field.key}>
					<ConfigField
						field={field}
						onChange={(value) => setField(field.key, value)}
						readOnly={readOnly}
						value={config[field.key]}
					/>
				</div>
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
				<Field>
					<FieldLabel>{field.label}</FieldLabel>
					<NumberInput
						disabled={readOnly}
						max={field.max}
						min={field.min}
						onValueChange={(next) => onChange(next ?? 0)}
						value={numberOrNull.parse(value ?? null)}
					/>
				</Field>
			);
		case "boolean":
			return (
				<Label className="flex items-center gap-2">
					<Checkbox
						checked={value === true}
						disabled={readOnly}
						onCheckedChange={(checked) => onChange(checked)}
					/>
					{field.label}
				</Label>
			);
		case "enum":
			return (
				<Field>
					<FieldLabel>{field.label}</FieldLabel>
					<Select
						disabled={readOnly}
						items={field.options.map((option) => ({
							value: option,
							label: option,
						}))}
						native
						onValueChange={(next) => onChange(next ?? "")}
						value={typeof value === "string" ? value : ""}
					/>
				</Field>
			);
		case "string-list":
			return (
				<Field>
					<FieldLabel>{field.label} (one per line)</FieldLabel>
					{/* uncontrolled: normalizing on change would eat typed newlines */}
					<Textarea
						defaultValue={
							Array.isArray(value)
								? value.filter((v) => typeof v === "string").join("\n")
								: ""
						}
						disabled={readOnly}
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
				</Field>
			);
		case "string":
			return (
				<Field>
					<FieldLabel>{field.label}</FieldLabel>
					<Input
						autoComplete="off"
						disabled={readOnly}
						onChange={(event) => onChange(event.target.value)}
						value={typeof value === "string" ? value : ""}
					/>
				</Field>
			);
		case "json":
			// Fallback for shapes introspection can't name — raw JSON per field.
			return (
				<Field>
					<FieldLabel>{field.label} (JSON)</FieldLabel>
					<Textarea
						defaultValue={JSON.stringify(value ?? null, null, 2)}
						disabled={readOnly}
						onBlur={(event) => {
							try {
								onChange(JSON.parse(event.target.value) as JsonValue);
							} catch {
								// keep the previous value; validation flags bad config anyway
							}
						}}
						rows={3}
					/>
				</Field>
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
		<Field>
			<FieldLabel>Mode</FieldLabel>
			<Select
				disabled={readOnly}
				items={GATE_CATALOG.map((entry) => ({
					value: entry.mode,
					label: entry.name,
				}))}
				native
				onValueChange={(next) => {
					if (next) {
						onUpdate({ ...node, mode: next as GateMode });
					}
				}}
				value={node.mode}
			/>
			<FieldDescription>
				{GATE_CATALOG.find((entry) => entry.mode === node.mode)?.description}
			</FieldDescription>
		</Field>
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
	if (node.action === "request-review") {
		return (
			<ReviewerPicker node={node} onUpdate={onUpdate} readOnly={readOnly} />
		);
	}
	if (node.action !== "label") {
		return (
			<p className="type-body-sm text-text-2">
				This rule has no settings to change.
			</p>
		);
	}
	const labels = labelList
		.parse(node.params?.labels)
		.filter((label) => label !== undefined);
	return (
		<Field>
			<FieldLabel>Labels (comma or newline separated)</FieldLabel>
			{/* uncontrolled: normalizing on change would eat typed newlines */}
			<Textarea
				defaultValue={labels.join("\n")}
				disabled={readOnly}
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
			<FieldDescription>
				{ACTION_CATALOG.find((entry) => entry.action === "label")?.description}
			</FieldDescription>
		</Field>
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
		} catch {
			setTestResult({
				ok: false,
				failure: "Tripwire could not run the test. Try again.",
			});
		} finally {
			setTesting(false);
		}
	};
	return (
		<div className="flex flex-col gap-3">
			<Field>
				<FieldLabel>
					{node.action === "discord" ? "Discord webhook URL" : "Webhook URL"}
				</FieldLabel>
				<Input
					autoComplete="off"
					disabled={readOnly}
					onChange={(event) => {
						setParam("url", event.target.value);
						setTestResult(null);
					}}
					placeholder={
						urlSet
							? "Saved. Leave blank to keep it"
							: "https://example.com/hook"
					}
					type="url"
					value={url}
				/>
				<FieldDescription>
					HTTPS only. Private and internal addresses are refused.
				</FieldDescription>
			</Field>
			{node.action === "webhook" && looksLikeDiscordUrl(url) ? (
				<Alert announce={false} status="warn">
					<AlertDescription>
						This looks like a Discord URL. Use a Discord step instead. A webhook
						step sends raw JSON, and Discord does not accept it.
					</AlertDescription>
				</Alert>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					disabled={readOnly || url === ""}
					onClick={runTest}
					pending={testing}
					pendingLabel="Testing"
					size="sm"
					variant="secondary"
				>
					Test connection
				</Button>
				{testResult ? (
					<Status size="sm" status={testResult.ok ? "ok" : "fail"}>
						{testResult.ok
							? "Reached the address"
							: `Could not reach it: ${testResult.failure ?? "no reason given"}`}
					</Status>
				) : null}
			</div>
			{node.action === "webhook" ? (
				<Field>
					<FieldLabel optional>Signing secret</FieldLabel>
					<Input
						autoComplete="off"
						disabled={readOnly}
						mode="password"
						onChange={(event) => setParam("signingSecret", event.target.value)}
						placeholder={
							secretSet ? "Saved. Leave blank to keep it" : undefined
						}
						value={
							typeof params.signingSecret === "string"
								? params.signingSecret
								: ""
						}
					/>
					<FieldDescription>
						Signs each post so your receiver can verify it came from Tripwire.
					</FieldDescription>
				</Field>
			) : null}
			<p className="type-body-sm text-text-2">
				{
					ACTION_CATALOG.find((entry) => entry.action === node.action)
						?.description
				}
			</p>
		</div>
	);
}
