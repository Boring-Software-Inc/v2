import { inputLook, outputLook, ruleIdOf } from "@tripwire/contracts";
import { Button, IconButton } from "@tripwire/ui/button";
import { Add, Close, Except, Icon, Rules } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import { Select } from "@tripwire/ui/select";
import { Label } from "@tripwire/ui/typography";
import {
	Handle,
	type NodeProps,
	Position,
	useNodeConnections,
} from "@xyflow/react";
import { z } from "zod";
import type { TripwireFlowNode } from "#/components/workflows/editor/node-card";
import { useCustomRuleName } from "#/components/workflows/editor/node-issues";
import {
	type RuleChoice,
	useRuleGroups,
} from "#/components/workflows/editor/rule-groups-context";
import { ruleIcon, stepName } from "#/components/workflows/editor/step-meta";
import { WorkflowNodeFrame } from "#/components/workflows/editor/workflow-node-frame";
import type { SkipMode } from "#/lib/rule-groups";

export const GROUP_TITLE = "If any of these rules fail";
export const SKIP_TITLE = "Skip when";

const MODE_ITEMS = [
	{ value: "all-of", label: "All of" },
	{ value: "any-of", label: "Any of" },
] satisfies { value: SkipMode; label: string }[];

const skipModeSchema = z.enum(["all-of", "any-of"]);

function InputPort({ title }: { title: string }) {
	const look = inputLook("rule");
	const incoming = useNodeConnections({ handleType: "target" });
	if (!look) {
		return null;
	}
	return (
		<Handle
			data-port-io="in"
			data-port-linked={incoming.length > 0 || undefined}
			data-port-shape={look.shape}
			data-port-slot="top"
			data-port-tone={look.tone}
			isConnectableStart={false}
			position={Position.Left}
			title={title}
			type="target"
		/>
	);
}

function OutputPort({ port }: { port: "pass" | "fail" }) {
	const look = outputLook(port);
	const outgoing = useNodeConnections({ handleType: "source" });
	return (
		<Handle
			data-port-io="out"
			data-port-linked={outgoing.length > 0 || undefined}
			data-port-negated={look.negated || undefined}
			data-port-shape={look.shape}
			data-port-slot="top"
			data-port-tone={look.tone}
			id={port === "fail" ? "fail" : undefined}
			position={Position.Right}
			type="source"
		/>
	);
}

function MemberRow({
	nodeId,
	removable,
	onRemove,
}: {
	nodeId: string;
	removable: boolean;
	onRemove: () => void;
}) {
	const { nodes, select, readOnly } = useRuleGroups();
	const node = nodes.get(nodeId);
	const ref = node?.type === "rule" ? node.ref : "";
	const customName = useCustomRuleName(ref);
	if (node?.type !== "rule") {
		return null;
	}
	const name = stepName(node, customName);
	return (
		<li className="nodrag nopan" data-layout-role="rule-card-member">
			<Button
				ariaLabel={`Edit ${name}`}
				data-layout-role="rule-card-member-select"
				onAction={() => select(nodeId)}
				size="small"
				variant="ghost"
			>
				<Icon
					data-layout-role="rule-card-member-icon"
					icon={ruleIcon(node.ref)}
				/>
				<span data-layout-role="rule-card-member-name">{name}</span>
			</Button>
			{removable && !readOnly ? (
				<Button
					ariaLabel={`Remove ${name}`}
					onAction={onRemove}
					size="small"
					variant="ghost"
				>
					<Icon icon={Close} />
				</Button>
			) : null}
		</li>
	);
}

function AddRuleMenu({
	label,
	exclude,
	onPick,
}: {
	label: string;
	exclude: ReadonlySet<string>;
	onPick: (choice: RuleChoice) => void;
}) {
	const { choices, readOnly } = useRuleGroups();
	if (readOnly) {
		return null;
	}
	const open = choices.filter((choice) => !exclude.has(ruleIdOf(choice.ref)));
	const items: MenuEntry[] = open.map((choice) => ({
		icon: <Icon icon={ruleIcon(choice.ref)} />,
		label: choice.name,
		onAction: () => onPick(choice),
		value: choice.ref,
	}));
	return (
		<div className="nodrag nopan">
			<Menu
				align="start"
				ariaLabel={label}
				items={items}
				trigger={
					<IconButton
						icon={<Icon icon={Add} />}
						label={label}
						size="small"
						variant="ghost"
					/>
				}
			/>
		</div>
	);
}

function refsOf(
	nodes: ReadonlyMap<string, { type: string; ref?: string }>,
	ids: readonly string[],
): Set<string> {
	return new Set(
		ids.flatMap((id) => {
			const node = nodes.get(id);
			return node?.ref ? [ruleIdOf(node.ref)] : [];
		}),
	);
}

export function RuleGroupNode({ id, selected }: NodeProps<TripwireFlowNode>) {
	const api = useRuleGroups();
	const card = api.view.cards.get(id);
	if (card?.kind !== "group") {
		return null;
	}
	const removable = card.ruleIds.length > 1;
	return (
		<WorkflowNodeFrame nodeId={id} selected={selected}>
			<InputPort title={GROUP_TITLE} />
			<div data-layout-role="rule-card-header">
				<Icon data-layout-role="rule-card-icon" icon={Rules} />
				<Label data-layout-role="rule-card-title">{GROUP_TITLE}</Label>
			</div>
			<ul data-layout-role="rule-card-members">
				{card.ruleIds.map((ruleId) => (
					<MemberRow
						key={ruleId}
						nodeId={ruleId}
						onRemove={() => api.removeRule(id, ruleId)}
						removable={removable}
					/>
				))}
			</ul>
			<div data-layout-role="rule-card-actions">
				<AddRuleMenu
					exclude={refsOf(api.nodes, card.ruleIds)}
					label="Add rule"
					onPick={(choice) => api.addRule(id, choice)}
				/>
				{card.skipId === null && !api.readOnly ? (
					<span
						className="nodrag nopan"
						data-layout-role="rule-card-attach-skip"
					>
						<Button
							leadingIcon={<Icon icon={Add} />}
							onAction={() => api.attachSkip(id)}
							size="small"
							variant="ghost"
						>
							{SKIP_TITLE}
						</Button>
					</span>
				) : null}
			</div>
			<OutputPort port="fail" />
		</WorkflowNodeFrame>
	);
}

export function SkipWhenNode({ id, selected }: NodeProps<TripwireFlowNode>) {
	const api = useRuleGroups();
	const card = api.view.cards.get(id);
	if (card?.kind !== "skip") {
		return null;
	}
	return (
		<WorkflowNodeFrame nodeId={id} selected={selected}>
			<InputPort title={SKIP_TITLE} />
			<div data-layout-role="rule-card-header">
				<Icon data-layout-role="rule-card-icon" icon={Except} />
				<Label data-layout-role="rule-card-title">{SKIP_TITLE}</Label>
				{api.readOnly ? null : (
					<span
						className="nodrag nopan"
						data-layout-role="rule-card-remove-skip"
					>
						<IconButton
							icon={<Icon icon={Close} />}
							label="Remove Skip when"
							onAction={() => api.removeSkip(id)}
							size="small"
							variant="ghost"
						/>
					</span>
				)}
			</div>
			{card.checkIds.length > 1 && card.gateId ? (
				<div className="nodrag nopan" data-layout-role="rule-card-mode">
					<Select
						ariaLabel="Skip when match"
						disabled={api.readOnly}
						onValueChange={(value) => {
							const mode = skipModeSchema.safeParse(value);
							if (mode.success && mode.data !== card.mode) {
								api.setMode(id, mode.data);
							}
						}}
						options={MODE_ITEMS}
						value={card.mode}
					/>
				</div>
			) : null}
			{card.checkIds.length > 0 ? (
				<ul data-layout-role="rule-card-members">
					{card.checkIds.map((checkId) => (
						<MemberRow
							key={checkId}
							nodeId={checkId}
							onRemove={() => api.removeCheck(id, checkId)}
							removable
						/>
					))}
				</ul>
			) : null}
			<AddRuleMenu
				exclude={refsOf(api.nodes, card.checkIds)}
				label="Add check"
				onPick={(choice) => api.addCheck(id, choice)}
			/>
			<OutputPort port="pass" />
		</WorkflowNodeFrame>
	);
}
