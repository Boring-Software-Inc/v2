import type { GateMode, JsonValue, WorkflowNode } from "@tripwire/contracts";
import {
	actionTakesSettings,
	GATE_CATALOG,
	jsonValueSchema,
	lockParamsSchema,
	MAX_COMMENT_MESSAGE,
	MAX_OUTCOME_MESSAGE,
} from "@tripwire/contracts";
import { Alert, AlertDescription } from "@tripwire/ui/alert";
import { Button } from "@tripwire/ui/button";
import { Checkbox } from "@tripwire/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldLabel,
	Input,
	Textarea,
} from "@tripwire/ui/field";
import { NumberInput } from "@tripwire/ui/number-input";
import { Select, type SelectOption } from "@tripwire/ui/select";
import { Status } from "@tripwire/ui/status";
import { SupportingText } from "@tripwire/ui/typography";
import { useState } from "react";
import { z } from "zod";
import { LabelPicker } from "#/components/workflows/editor/label-picker";
import {
	type FieldSpec,
	fieldsForSchema,
	ruleCatalogEntryForRef,
	ruleConfigFieldsSchema,
} from "#/components/workflows/editor/node-fields";
import { ReviewerPicker } from "#/components/workflows/editor/reviewer-picker";
import { TriggerFlow } from "#/components/workflows/editor/schedule-flow";

const numberOrNull = z.number().nullable().catch(null);
const labelList = z.array(z.string().optional().catch(undefined)).catch([]);
const textParam = z.string().catch("");

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
			return actionTakesSettings(node.action);
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
	return <TriggerFlow node={node} onUpdate={onUpdate} readOnly={readOnly} />;
}

const LOCK_REASON_OPTIONS = [
	{ value: "resolved", label: "Resolved" },
	{ value: "off-topic", label: "Off-topic" },
	{ value: "too heated", label: "Too heated" },
	{ value: "spam", label: "Spam" },
] as const satisfies readonly SelectOption<
	"resolved" | "off-topic" | "too heated" | "spam"
>[];

function LockFields({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "action" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	const parsed = lockParamsSchema.safeParse(node.params ?? {});
	const reason = parsed.success ? (parsed.data.reason ?? null) : null;
	return (
		<Field data-field="reason" data-layout-role="workflow-action-property">
			<FieldLabel>Reason</FieldLabel>
			<Select
				ariaLabel="Reason"
				disabled={readOnly}
				options={LOCK_REASON_OPTIONS}
				mode="native"
				onValueChange={(next) => {
					const { reason: _, ...rest } = node.params ?? {};
					onUpdate({
						...node,
						params: next ? { ...rest, reason: next } : rest,
					});
				}}
				placeholder="None"
				value={reason}
			/>
		</Field>
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
			<SupportingText>
				Unknown rule <span className="mono">{node.ref}</span>. It is not in the
				catalog.
			</SupportingText>
		);
	}
	const fields = fieldsForSchema(entry.configSchema) ?? [];
	if (fields.length === 0) {
		return (
			<SupportingText>This rule has no settings to change.</SupportingText>
		);
	}
	const config = ruleConfigFieldsSchema.parse(node.config);
	const setField = (key: string, value: JsonValue) => {
		onUpdate({ ...node, config: { ...config, [key]: value } });
	};
	return (
		<div data-layout-role="workflow-rule-properties">
			<SupportingText>{entry.blurb}</SupportingText>
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

export function ConfigField({
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
						ariaLabel={field.label}
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
				<div data-layout-role="workflow-boolean-property">
					<Checkbox
						checked={value === true}
						disabled={readOnly}
						label={field.label}
						onCheckedChange={(checked) => onChange(checked)}
					/>
				</div>
			);
		case "enum":
			return (
				<Field>
					<FieldLabel>{field.label}</FieldLabel>
					<Select
						ariaLabel={field.label}
						disabled={readOnly}
						options={field.options
							.map(String)
							.filter((option) => option.length > 0)
							.map((option) => ({ value: option, label: option }))}
						mode="native"
						onValueChange={(next) => onChange(next ?? "")}
						placeholder={`Select ${field.label}`}
						value={textParam.parse(value) || null}
					/>
				</Field>
			);
		case "string-list":
			return (
				<Field>
					<FieldLabel>{field.label} (one per line)</FieldLabel>
					{/** Normalizing on change would eat typed newlines. */}
					<Textarea
						defaultValue={labelList
							.parse(value)
							.filter((item) => item !== undefined)
							.join("\n")}
						disabled={readOnly}
						labelledByField
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
						labelledByField
						onValueChange={onChange}
						value={textParam.parse(value)}
					/>
				</Field>
			);
		case "json":
			return (
				<Field>
					<FieldLabel>{field.label} (JSON)</FieldLabel>
					<Textarea
						defaultValue={JSON.stringify(value ?? null, null, 2)}
						disabled={readOnly}
						labelledByField
						onBlur={(event) => {
							try {
								onChange(jsonValueSchema.parse(JSON.parse(event.target.value)));
							} catch {
								/** Keep the previous value while the JSON draft is incomplete. */
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
				ariaLabel="Mode"
				disabled={readOnly}
				options={GATE_CATALOG.map((entry) => ({
					value: entry.mode,
					label: entry.name,
				}))}
				mode="native"
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
	if (node.action === "lock") {
		return <LockFields node={node} onUpdate={onUpdate} readOnly={readOnly} />;
	}
	if (node.action === "post-comment") {
		return (
			<CommentFields node={node} onUpdate={onUpdate} readOnly={readOnly} />
		);
	}
	if (node.action === "request-fix" || node.action === "note") {
		return (
			<CommentFields
				label={node.action === "request-fix" ? "Instruction" : "Note"}
				maxLength={MAX_OUTCOME_MESSAGE}
				node={node}
				onUpdate={onUpdate}
				readOnly={readOnly}
			/>
		);
	}
	if (node.action !== "label" && node.action !== "remove-label") {
		return (
			<SupportingText>This step has no settings to change.</SupportingText>
		);
	}
	const labels = labelList
		.parse(node.params?.labels)
		.filter((label) => label !== undefined);
	return (
		<Field data-field="labels" data-layout-role="workflow-action-property">
			<FieldLabel>Labels</FieldLabel>
			<LabelPicker
				creatable
				onChange={(next) =>
					onUpdate({ ...node, params: { ...node.params, labels: next } })
				}
				readOnly={readOnly}
				value={labels}
			/>
		</Field>
	);
}

function CommentFields({
	node,
	readOnly,
	onUpdate,
	label = "Message",
	maxLength = MAX_COMMENT_MESSAGE,
}: {
	node: Extract<WorkflowNode, { type: "action" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
	label?: string;
	maxLength?: number;
}) {
	const message = textParam.parse(node.params?.message);
	return (
		<Field data-field="message" data-layout-role="workflow-action-property">
			<FieldLabel>{label}</FieldLabel>
			<Textarea
				disabled={readOnly}
				labelledByField
				maxLength={maxLength}
				onChange={(event) =>
					onUpdate({
						...node,
						params: { ...node.params, message: event.target.value },
					})
				}
				rows={5}
				value={message}
			/>
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
	const params = node.params ?? {};
	const setParam = (key: string, value: string) =>
		onUpdate({ ...node, params: { ...params, [key]: value } });
	const urlSet = params.urlSet === true;
	const secretSet = params.signingSecretSet === true;
	const url = textParam.parse(params.url);
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
				await onTestConnection(
					url,
					node.action === "discord" ? "discord" : "webhook",
				),
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
		<div data-layout-role="workflow-delivery-properties">
			<Field>
				<FieldLabel>
					{node.action === "discord" ? "Discord webhook URL" : "Webhook URL"}
				</FieldLabel>
				<Input
					autoComplete="off"
					disabled={readOnly}
					labelledByField
					onValueChange={(value) => {
						setParam("url", value);
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
				<Alert status="warning">
					<AlertDescription>
						This looks like a Discord URL. Use a Discord step instead. A webhook
						step sends raw JSON, and Discord does not accept it.
					</AlertDescription>
				</Alert>
			) : null}
			<div data-layout-role="workflow-delivery-test">
				<Button
					disabled={readOnly || url === ""}
					onAction={runTest}
					pending={testing}
					pendingLabel="Testing"
					size="small"
					variant="secondary"
				>
					Test connection
				</Button>
				{testResult ? (
					<Status size="small" status={testResult.ok ? "ok" : "fail"}>
						{testResult.ok
							? "Reached the address"
							: `Could not reach it: ${testResult.failure ?? "no reason given"}`}
					</Status>
				) : null}
			</div>
			{node.action === "webhook" ? (
				<Field>
					<FieldLabel>Signing secret (optional)</FieldLabel>
					<Input
						autoComplete="off"
						disabled={readOnly}
						labelledByField
						onValueChange={(value) => setParam("signingSecret", value)}
						placeholder={
							secretSet ? "Saved. Leave blank to keep it" : undefined
						}
						type="password"
						value={textParam.parse(params.signingSecret)}
					/>
					<FieldDescription>
						Signs each post so your receiver can verify it came from Tripwire.
					</FieldDescription>
				</Field>
			) : null}
		</div>
	);
}
