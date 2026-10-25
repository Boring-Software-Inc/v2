import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { ChainMark, TONE_WORD } from "#/components/runs/chain-mark";
import { RuleEvidence } from "#/components/runs/rule-evidence";
import {
	branchOutcomeLabel,
	branchSummary,
	type ChainBranch,
	type ChainRule,
	type ChainSkip,
	passedNote,
	ruleReason,
} from "#/lib/run-chain";
import { cn } from "#/lib/utils";

export interface BranchContext {
	level: number;
	maintainer: boolean;
	repo: string;
	sha: string | null;
}

function joinNames(rules: readonly ChainRule[]): string {
	return rules.map((rule) => rule.name).join(", ");
}

function PassedFold({
	rules,
	context,
}: {
	rules: ChainRule[];
	context: BranchContext;
}) {
	return (
		<Collapsible className="rule-row gap-2 px-3 py-2">
			<div className="flex items-start gap-2">
				<CollapsibleTrigger size="sm">
					<span className="flex items-baseline gap-1.5">
						<ChainMark glyph="pass" size={12} tone="ok" />
						<span className="text-ok-text">{`${rules.length} passed`}</span>
					</span>
				</CollapsibleTrigger>
				<span className="min-w-0 flex-1 pt-1 type-body-sm text-text-2">
					{joinNames(rules)}
				</span>
			</div>
			<CollapsibleContent hiddenUntilFound>
				<ul className="flex flex-col gap-1 ps-2 pb-1">
					{rules.map((rule) => {
						const note = passedNote(rule, context.level, context.maintainer);
						return (
							<li
								className="flex flex-col gap-0.5 type-body-sm text-text-2"
								key={rule.step.id}
							>
								<span className="flex items-baseline gap-2">
									<span className="min-w-0 flex-1 type-label text-text-1">
										{rule.name}
									</span>
									{note?.model ? (
										<span className="min-w-0 truncate type-code-sm">
											{note.model}
										</span>
									) : null}
									<span className="shrink-0 type-caption">
										{rule.step.durationMs}ms
									</span>
								</span>
								{note ? (
									<p className="[overflow-wrap:anywhere]">{note.summary}</p>
								) : null}
							</li>
						);
					})}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}

function FlaggedRule({
	rule,
	context,
}: {
	rule: ChainRule;
	context: BranchContext;
}) {
	const failed = rule.mark === "fail";
	const reason = ruleReason(rule, context.level);
	return (
		<div className="rule-row flex gap-2 px-3 pt-3 pb-4">
			<ChainMark
				glyph={failed ? "fail" : "skipped"}
				tone={failed ? "fail" : "neutral"}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-baseline gap-x-2">
					<span className="type-label text-text-1">{rule.name}</span>
					<span
						className={cn(
							"type-label-sm",
							failed ? "text-fail-text" : "text-text-2",
						)}
					>
						{failed ? "Did not pass" : "Skipped"}
					</span>
					<span className="type-caption text-text-2">
						{rule.step.durationMs}ms
					</span>
				</div>
				{reason ? (
					<p className="type-body text-text-1 [overflow-wrap:anywhere]">
						{reason}
					</p>
				) : null}
				{failed ? (
					<RuleEvidence
						maintainer={context.maintainer}
						repo={context.repo}
						sha={context.sha}
						step={rule.step}
					/>
				) : null}
			</div>
		</div>
	);
}

const RULE_MARK_LOOK = {
	pass: { glyph: "pass", tone: "ok" },
	fail: { glyph: "fail", tone: "fail" },
	skipped: { glyph: "skipped", tone: "neutral" },
	pending: { glyph: "running", tone: "neutral" },
} as const;

function SkipRow({
	skip,
	context,
}: {
	skip: ChainSkip;
	context: BranchContext;
}) {
	return (
		<div className="rule-row flex gap-2 px-3 pt-3 pb-4" data-skip={skip.state}>
			<ChainMark glyph={skip.glyph} tone={skip.tone} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="type-label text-text-1 [overflow-wrap:anywhere]">
					{skip.text}
				</span>
				{skip.checks.length > 0 ? (
					<ul className="flex flex-col gap-1">
						{skip.checks.map((rule) => {
							const look = RULE_MARK_LOOK[rule.mark];
							const reason = ruleReason(rule, context.level);
							return (
								<li
									className="flex flex-col gap-0.5 type-body-sm text-text-2"
									key={rule.step.id}
								>
									<span className="flex items-baseline gap-1.5">
										<ChainMark glyph={look.glyph} size={12} tone={look.tone} />
										<span className="min-w-0 [overflow-wrap:anywhere]">
											{rule.name}
										</span>
									</span>
									{reason ? (
										<p className="ps-5 [overflow-wrap:anywhere]">{reason}</p>
									) : null}
									<div className="ps-3">
										<RuleEvidence
											maintainer={context.maintainer}
											repo={context.repo}
											sha={context.sha}
											step={rule.step}
										/>
									</div>
								</li>
							);
						})}
					</ul>
				) : null}
			</div>
		</div>
	);
}

function PendingRule({ rule }: { rule: ChainRule }) {
	return (
		<div className="rule-row flex items-center gap-2 px-3 py-2">
			<ChainMark glyph="running" tone="neutral" />
			<span className="type-label text-text-1">{rule.name}</span>
			<span className="type-label-sm text-text-2">Checking</span>
		</div>
	);
}

function BranchBody({
	branch,
	context,
}: {
	branch: ChainBranch;
	context: BranchContext;
}) {
	return (
		<div className="flex flex-col">
			{branch.outcome === "unrunnable" ? (
				<p className="rule-row px-3 py-2 type-body text-text-1">
					Its wiring is broken, so Tripwire did not run it.
				</p>
			) : null}
			{branch.passed.length > 0 ? (
				<PassedFold context={context} rules={branch.passed} />
			) : null}
			{branch.flagged.map((rule) => (
				<FlaggedRule context={context} key={rule.step.id} rule={rule} />
			))}
			{branch.skips.map((skip) => (
				<SkipRow context={context} key={skip.id} skip={skip} />
			))}
			{branch.pending.map((rule) => (
				<PendingRule key={rule.step.id} rule={rule} />
			))}
		</div>
	);
}

function BranchOutcome({ branch }: { branch: ChainBranch }) {
	const outcome = branchOutcomeLabel(branch);
	if (!outcome) {
		return null;
	}
	return (
		<CardFooter className="justify-start">
			<span className="flex items-center gap-2">
				<ChainMark glyph={outcome.glyph} tone={outcome.tone} />
				<span className={cn("type-label", TONE_WORD[outcome.tone])}>
					{outcome.label}
				</span>
			</span>
		</CardFooter>
	);
}

export function BranchCard({
	branch,
	context,
	showOutcome,
	className,
}: {
	branch: ChainBranch;
	context: BranchContext;
	showOutcome: boolean;
	className?: string;
}) {
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle className="truncate" title={branch.name}>
					{branch.name}
				</CardTitle>
			</CardHeader>
			<CardContent flush>
				<BranchBody branch={branch} context={context} />
			</CardContent>
			{showOutcome ? <BranchOutcome branch={branch} /> : null}
		</Card>
	);
}

export function BranchRow({
	branch,
	context,
}: {
	branch: ChainBranch;
	context: BranchContext;
}) {
	const summary = branchSummary(branch);
	return (
		<Card>
			<Collapsible>
				<div className="px-3 py-2">
					<CollapsibleTrigger>
						<span className="flex min-w-0 items-baseline gap-1.5">
							<ChainMark glyph={summary.glyph} size={12} tone={summary.tone} />
							<span className="min-w-0 truncate" title={branch.name}>
								{branch.name}
							</span>
							<span
								className={cn(
									"max-w-1/2 shrink-0 truncate type-caption group-data-panel-open/collapsible-trigger:hidden",
									summary.tone === "fail" ? "text-fail-text" : "text-text-2",
								)}
								title={summary.text}
							>
								{summary.text}
							</span>
						</span>
					</CollapsibleTrigger>
				</div>
				<CollapsibleContent className="border-line-faint border-t">
					<BranchBody branch={branch} context={context} />
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}

export function PassedGroup({
	branches,
	context,
}: {
	branches: ChainBranch[];
	context: BranchContext;
}) {
	const noun = branches.length === 1 ? "workflow" : "workflows";
	return (
		<Card>
			<Collapsible>
				<div className="flex items-start gap-2 px-3 py-2">
					<CollapsibleTrigger>
						<span className="flex items-baseline gap-1.5">
							<ChainMark glyph="pass" size={12} tone="ok" />
							<span className="text-ok-text">{`${branches.length} ${noun} passed`}</span>
						</span>
					</CollapsibleTrigger>
					<span className="min-w-0 flex-1 pt-1.5 type-body-sm text-text-2">
						{branches.map((branch) => branch.name).join(", ")}
					</span>
				</div>
				<CollapsibleContent className="border-line-faint border-t">
					{branches.map((branch) => (
						<Collapsible className="rule-row" key={branch.id}>
							<div className="px-3 py-1.5">
								<CollapsibleTrigger
									size="sm"
									summary={`${branch.passed.length} passed`}
									title={branch.name}
								>
									{branch.name}
								</CollapsibleTrigger>
							</div>
							<CollapsibleContent className="border-line-faint border-t">
								<BranchBody branch={branch} context={context} />
							</CollapsibleContent>
						</Collapsible>
					))}
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}
