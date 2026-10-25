import { Link } from "@tanstack/react-router";
import {
	MAX_OUTCOME_MESSAGE,
	RULE_OUTCOME_LABELS,
	type RuleOutcomeSetting,
} from "@tripwire/contracts";
import { type ReactNode, useState } from "react";
import { ArrowRight, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { CardFooter } from "#/components/glaze/ui/card";
import { Input } from "#/components/glaze/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";
import { RULE_FOOTER_CLASS } from "#/components/rules/rule-card-frame";
import {
	isRuleOutcome,
	OUTCOME_LEAD,
	type OutcomeLine,
	outcomeFooterState,
	RULE_OUTCOME_ITEMS,
	withInstruction,
	withOutcome,
} from "#/components/rules/rule-outcome";
import { cn } from "#/lib/glaze/utils";
import type { RuleConfigView } from "#/lib/rules.functions";

const ROW_CLASS =
	"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-visible whitespace-normal";

export function RuleOutcomeFooter({
	org,
	repo,
	rule,
	canEdit,
	off,
	activity,
	onOutcomeChange,
}: {
	org: string;
	repo: string;
	rule: RuleConfigView;
	canEdit: boolean;
	off: boolean;
	activity: ReactNode;
	onOutcomeChange?: (rule: RuleConfigView, next: RuleOutcomeSetting) => void;
}) {
	const state = outcomeFooterState(rule);
	const editable = canEdit && onOutcomeChange !== undefined;
	const change = (next: RuleOutcomeSetting) => onOutcomeChange?.(rule, next);

	return (
		<CardFooter
			className={cn(
				RULE_FOOTER_CLASS,
				"flex-col items-stretch gap-1.5 overflow-visible",
			)}
		>
			{state.kind === "managed" ? (
				<ManagedBy org={org} owners={state.owners} repo={repo} />
			) : (
				<OutcomePicker
					editable={editable}
					off={off}
					onChange={(outcome) => change(withOutcome(state.setting, outcome))}
					ruleName={rule.name}
					setting={state.setting}
				/>
			)}
			{state.kind === "standalone" && state.line ? (
				<OutcomeLineField
					editable={editable}
					key={`${state.setting.outcome}:${state.setting.instruction}`}
					line={state.line}
					onSave={(text) => change(withInstruction(state.setting, text))}
					ruleName={rule.name}
					value={state.setting.instruction}
				/>
			) : null}
			<div className={ROW_CLASS}>{activity}</div>
		</CardFooter>
	);
}

function OutcomePicker({
	setting,
	editable,
	off,
	ruleName,
	onChange,
}: {
	setting: RuleOutcomeSetting;
	editable: boolean;
	off: boolean;
	ruleName: string;
	onChange: (outcome: RuleOutcomeSetting["outcome"]) => void;
}) {
	return (
		<span className={ROW_CLASS}>
			<span className="type-label-sm">{OUTCOME_LEAD}:</span>
			{editable ? (
				<Select
					items={RULE_OUTCOME_ITEMS}
					onValueChange={(value) => {
						if (isRuleOutcome(value) && value !== setting.outcome) {
							onChange(value);
						}
					}}
					value={setting.outcome}
				>
					<SelectTrigger
						aria-label={`${OUTCOME_LEAD} for ${ruleName}`}
						className="w-auto"
						size="sm"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent size="sm">
						{RULE_OUTCOME_ITEMS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<span
					className={cn("type-label-sm", off ? "text-text-2" : "text-text-1")}
				>
					{RULE_OUTCOME_LABELS[setting.outcome]}
				</span>
			)}
		</span>
	);
}

function OutcomeLineField({
	line,
	value,
	editable,
	ruleName,
	onSave,
}: {
	line: OutcomeLine;
	value: string;
	editable: boolean;
	ruleName: string;
	onSave: (text: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	if (!editable) {
		return value === "" ? null : (
			<p className={ROW_CLASS}>
				<span className="type-label-sm">{line.label}:</span>
				<span className="text-text-1">{value}</span>
			</p>
		);
	}
	const commit = () => {
		if (draft.trim() !== value) {
			onSave(draft);
		}
	};
	return (
		<div className={cn(ROW_CLASS, "flex-nowrap")}>
			<span className="shrink-0 type-label-sm">{line.label}:</span>
			<Input
				aria-label={`${line.label} for ${ruleName}`}
				className="min-w-0 flex-1"
				maxLength={MAX_OUTCOME_MESSAGE}
				onBlur={commit}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
					if (event.key === "Escape") {
						setDraft(value);
					}
				}}
				placeholder={line.placeholder}
				size="sm"
				value={draft}
			/>
		</div>
	);
}

function ManagedBy({
	org,
	repo,
	owners,
}: {
	org: string;
	repo: string;
	owners: { id: string; name: string }[];
}) {
	return (
		<span className="flex min-w-0 flex-col gap-1 overflow-visible">
			{owners.map((owner) => (
				<span className={ROW_CLASS} key={owner.id}>
					<span className="type-label-sm">Set in {owner.name}</span>
					<Button
						nativeButton={false}
						render={
							<Link
								params={{ org, repo, workflowId: owner.id }}
								to="/$org/$repo/workflows/$workflowId"
							/>
						}
						size="sm"
						variant="secondary"
					>
						Edit workflow
						<Icon icon={ArrowRight} />
					</Button>
				</span>
			))}
		</span>
	);
}
