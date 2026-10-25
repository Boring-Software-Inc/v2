import { inputLook, outputLook, ruleIdOf } from "@tripwire/contracts";
import {
	Handle,
	type NodeProps,
	Position,
	useNodeConnections,
} from "@xyflow/react";
import { Add, Close, Except, Icon, Rules } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import { StatusMark } from "#/components/glaze/ui/status";
import {
	NodeAgentOutline,
	NodeEnterDissolve,
} from "#/components/workflows/editor/agent-work-context";
import type { TripwireFlowNode } from "#/components/workflows/editor/node-card";
import {
	useCustomRuleName,
	useNodeProblems,
	useProblems,
} from "#/components/workflows/editor/node-issues";
import {
	ProblemPeek,
	severityStatus,
} from "#/components/workflows/editor/problems-list";
import {
	type RuleChoice,
	useRuleGroups,
} from "#/components/workflows/editor/rule-groups-context";
import { ruleIcon, stepName } from "#/components/workflows/editor/step-meta";
import { cn } from "#/lib/glaze/utils";
import type { SkipMode } from "#/lib/rule-groups";

export const GROUP_TITLE = "If any of these rules fail";
export const SKIP_TITLE = "Skip when";

const MODE_ITEMS = [
	{ value: "all-of", label: "All of" },
	{ value: "any-of", label: "Any of" },
] satisfies { value: SkipMode; label: string }[];

function isSkipMode(value: unknown): value is SkipMode {
	return value === "all-of" || value === "any-of";
}

function CardFrame({
	id,
	selected,
	children,
}: {
	id: string;
	selected: boolean;
	children: React.ReactNode;
}) {
	const problems = useNodeProblems(id);
	const { onFix } = useProblems();
	const status = problems.length > 0 ? severityStatus(problems) : null;
	return (
		<>
			<div
				className={cn(
					"relative w-56 rounded-panel border border-line-faint bg-paper px-3 py-2 text-text-1 transition-colors duration-(--dur-state)",
					selected && "border-ink",
					status === "fail" && !selected && "border-fail",
					status === "warn" && !selected && "border-warn",
				)}
			>
				<NodeAgentOutline nodeId={id} />
				{status ? (
					<ProblemPeek
						className="absolute -top-2 -right-2 flex rounded-pill bg-paper"
						onFix={onFix}
						problems={problems}
					>
						<StatusMark
							label={problems.map((problem) => problem.message).join(". ")}
							status={status}
						/>
					</ProblemPeek>
				) : null}
				{children}
			</div>
			<NodeEnterDissolve nodeId={id} />
		</>
	);
}

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
		<li className="flex min-w-0 items-center gap-1">
			<Button
				aria-label={`Edit ${name}`}
				className="h-auto min-h-7 min-w-0 flex-1 justify-start gap-2 whitespace-normal py-1 text-start"
				onClick={() => select(nodeId)}
				size="sm"
				variant="ghost"
			>
				<Icon className="shrink-0" icon={ruleIcon(node.ref)} />
				<span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
			</Button>
			{removable && !readOnly ? (
				<Button
					aria-label={`Remove ${name}`}
					onClick={onRemove}
					size="icon-sm"
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
	const builtIn = open.filter((choice) => !choice.custom);
	const custom = open.filter((choice) => choice.custom);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button className="mt-1 self-start" size="sm" variant="ghost" />
				}
			>
				<Icon icon={Add} />
				{label}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" size="sm">
				{[
					{ title: "Rules", items: builtIn },
					{ title: "Custom rules", items: custom },
				]
					.filter((section) => section.items.length > 0)
					.map((section) => (
						<DropdownMenuGroup key={section.title}>
							<DropdownMenuLabel>{section.title}</DropdownMenuLabel>
							{section.items.map((choice) => (
								<DropdownMenuItem
									key={choice.ref}
									onClick={() => onPick(choice)}
								>
									<Icon icon={ruleIcon(choice.ref)} />
									{choice.name}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					))}
			</DropdownMenuContent>
		</DropdownMenu>
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
		<CardFrame id={id} selected={selected}>
			<InputPort title={GROUP_TITLE} />
			<div className="flex items-center gap-2">
				<Icon className="-ms-1.5 shrink-0 text-text-1" icon={Rules} />
				<span className="min-w-0 type-label">{GROUP_TITLE}</span>
			</div>
			<ul className="mt-2 flex flex-col border-line-faint border-t pt-1">
				{card.ruleIds.map((ruleId) => (
					<MemberRow
						key={ruleId}
						nodeId={ruleId}
						onRemove={() => api.removeRule(id, ruleId)}
						removable={removable}
					/>
				))}
			</ul>
			<div className="flex flex-wrap items-center gap-1">
				<AddRuleMenu
					exclude={refsOf(api.nodes, card.ruleIds)}
					label="Add rule"
					onPick={(choice) => api.addRule(id, choice)}
				/>
				{card.skipId === null && !api.readOnly ? (
					<Button
						className="mt-1"
						onClick={() => api.attachSkip(id)}
						size="sm"
						variant="ghost"
					>
						<Icon icon={Add} />
						{SKIP_TITLE}
					</Button>
				) : null}
			</div>
			<OutputPort port="fail" />
		</CardFrame>
	);
}

export function SkipWhenNode({ id, selected }: NodeProps<TripwireFlowNode>) {
	const api = useRuleGroups();
	const card = api.view.cards.get(id);
	if (card?.kind !== "skip") {
		return null;
	}
	return (
		<CardFrame id={id} selected={selected}>
			<InputPort title={SKIP_TITLE} />
			<div className="flex items-center gap-2">
				<Icon className="-ms-1.5 shrink-0 text-text-1" icon={Except} />
				<span className="min-w-0 type-label">{SKIP_TITLE}</span>
				{api.readOnly ? null : (
					<Button
						aria-label="Remove Skip when"
						className="ms-auto"
						onClick={() => api.removeSkip(id)}
						size="icon-sm"
						variant="ghost"
					>
						<Icon icon={Close} />
					</Button>
				)}
			</div>
			{card.checkIds.length > 1 && card.gateId ? (
				<div className="mt-1">
					<Select
						disabled={api.readOnly}
						items={MODE_ITEMS}
						onValueChange={(value) => {
							if (isSkipMode(value) && value !== card.mode) {
								api.setMode(id, value);
							}
						}}
						value={card.mode}
					>
						<SelectTrigger
							aria-label="Skip when match"
							className="w-auto"
							size="sm"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{MODE_ITEMS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}
			{card.checkIds.length > 0 ? (
				<ul className="mt-2 flex flex-col border-line-faint border-t pt-1">
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
		</CardFrame>
	);
}
