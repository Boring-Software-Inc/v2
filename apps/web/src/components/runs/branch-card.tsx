import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@tripwire/ui/card";
import { Collapsible } from "@tripwire/ui/collapsible";
import { Caption } from "@tripwire/ui/typography";
import { ChainMark, TONE_WORD } from "#/components/runs/chain-mark";
import { RuleEvidence } from "#/components/runs/rule-evidence";
import {
	branchOutcomeLabel,
	branchSummary,
	type ChainBranch,
	type ChainRule,
	type ChainSkip,
	formatDuration,
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

function PassedFold({
	rules,
	context,
}: {
	rules: ChainRule[];
	context: BranchContext;
}) {
	const disclosure = context.maintainer
		? { variant: "compact" as const }
		: { variant: "default" as const };
	return (
		<div
			className="rule-row composition-gap-standard composition-inline-inset branch-rule-row-inset"
			data-layout-role={
				context.maintainer ? "private-run-passed-fold" : undefined
			}
		>
			<Collapsible
				hiddenUntilFound
				trigger={
					<span className="flex items-baseline composition-gap-control">
						<ChainMark glyph="pass" size={12} tone="ok" />
						<span className="tone-success">{`${rules.length} passed`}</span>
					</span>
				}
				triggerTone={context.maintainer ? "default" : "quiet"}
				{...disclosure}
			>
				<ul className="flex flex-col composition-gap-small branch-passed-list-inset">
					{rules.map((rule) => {
						const note = passedNote(rule, context.level, context.maintainer);
						return (
							<li
								className="flex flex-col composition-gap-hairline content-body-small tone-content-secondary"
								key={rule.step.id}
							>
								<span className="flex items-baseline composition-gap-standard">
									<span className="min-w-0 flex-1 content-label tone-content-primary">
										{rule.name}
									</span>
									{note?.model ? (
										<span className="min-w-0 truncate content-code-small">
											{note.model}
										</span>
									) : null}
									{formatDuration(rule.step.durationMs) ? (
										<span className="shrink-0">
											<Caption>{formatDuration(rule.step.durationMs)}</Caption>
										</span>
									) : null}
								</span>
								{note ? (
									<p className="content-break-anywhere">{note.summary}</p>
								) : null}
							</li>
						);
					})}
				</ul>
			</Collapsible>
		</div>
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
		<div className="rule-row flex composition-gap-standard composition-inline-inset branch-evidence-inset">
			<ChainMark
				glyph={failed ? "fail" : "skipped"}
				tone={failed ? "fail" : "neutral"}
			/>
			<div className="flex min-w-0 flex-1 flex-col composition-gap-small">
				<div className="flex flex-wrap items-baseline gap-x-2">
					<span className="content-label tone-content-primary">
						{rule.name}
					</span>
					<span
						className={cn(
							"content-label-small",
							failed ? "tone-danger" : "tone-content-secondary",
						)}
					>
						{failed ? "Did not pass" : "Skipped"}
					</span>
					{formatDuration(rule.step.durationMs) ? (
						<Caption>{formatDuration(rule.step.durationMs)}</Caption>
					) : null}
				</div>
				{reason ? (
					<p
						data-layout-role="run-rule-reason"
						className="content-body tone-content-primary content-break-anywhere"
					>
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
		<div
			className="rule-row flex composition-gap-standard composition-inline-inset branch-evidence-inset"
			data-skip={skip.state}
		>
			<ChainMark glyph={skip.glyph} tone={skip.tone} />
			<div className="flex min-w-0 flex-1 flex-col composition-gap-small">
				<span className="content-label tone-content-primary content-break-anywhere">
					{skip.text}
				</span>
				{skip.checks.length > 0 ? (
					<ul className="flex flex-col composition-gap-small">
						{skip.checks.map((rule) => {
							const look = RULE_MARK_LOOK[rule.mark];
							const reason = ruleReason(rule, context.level);
							return (
								<li
									className="flex flex-col composition-gap-hairline content-body-small tone-content-secondary"
									key={rule.step.id}
								>
									<span className="flex items-baseline composition-gap-control">
										<ChainMark glyph={look.glyph} size={12} tone={look.tone} />
										<span className="min-w-0 content-break-anywhere">
											{rule.name}
										</span>
									</span>
									{reason ? (
										<p className="branch-reason-inset content-break-anywhere">
											{reason}
										</p>
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
		<div className="rule-row flex items-center composition-gap-standard composition-inline-inset branch-rule-row-inset">
			<ChainMark glyph="running" tone="neutral" />
			<span className="content-label tone-content-primary">{rule.name}</span>
			<span className="content-label-small tone-content-secondary">
				Checking
			</span>
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
				<p className="rule-row composition-inline-inset branch-rule-row-inset content-body tone-content-primary">
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
		<CardFooter data-layout-role="run-branch-outcome">
			<span className="flex items-center composition-gap-standard">
				<ChainMark glyph={outcome.glyph} tone={outcome.tone} />
				<span className={cn("content-label", TONE_WORD[outcome.tone])}>
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
}: {
	branch: ChainBranch;
	context: BranchContext;
	showOutcome: boolean;
}) {
	return (
		<Card
			data-feedback-name="BranchCard"
			data-layout-role="run-branch-card"
			data-private={context.maintainer || undefined}
		>
			<CardHeader>
				<CardTitle data-layout-role="run-branch-title" title={branch.name}>
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
	const mark = (
		<ChainMark glyph={summary.glyph} size={12} tone={summary.tone} />
	);
	const summaryLabel = (
		<span
			className={cn(
				"block truncate content-caption",
				summary.tone === "fail" ? "tone-danger" : "tone-content-secondary",
			)}
			title={summary.text}
		>
			{summary.text}
		</span>
	);
	if (context.maintainer) {
		return (
			<Card data-layout-role="private-run-branch-row">
				<Collapsible
					closedSummary={summaryLabel}
					trigger={
						<span className="flex min-w-0 items-center composition-gap-control">
							{mark}
							<span className="min-w-0 truncate" title={branch.name}>
								{branch.name}
							</span>
						</span>
					}
					variant="compact"
				>
					<BranchBody branch={branch} context={context} />
				</Collapsible>
			</Card>
		);
	}
	return (
		<Card>
			<div className="composition-inline-inset branch-rule-row-inset">
				<Collapsible
					panelVariant="bordered"
					trigger={
						<span className="flex min-w-0 items-baseline composition-gap-control">
							{mark}
							<span className="min-w-0 truncate" title={branch.name}>
								{branch.name}
							</span>
							<span
								className={cn(
									"max-w-1/2 shrink-0 truncate content-caption group-data-panel-open/collapsible-trigger:hidden",
									summary.tone === "fail"
										? "tone-danger"
										: "tone-content-secondary",
								)}
								title={summary.text}
							>
								{summary.text}
							</span>
						</span>
					}
				>
					<BranchBody branch={branch} context={context} />
				</Collapsible>
			</div>
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
			<div className="composition-inline-inset branch-rule-row-inset">
				<Collapsible
					header={{
						content: (
							<span className="min-w-0 flex-1 composition-top-control content-body-small tone-content-secondary">
								{branches.map((branch) => branch.name).join(", ")}
							</span>
						),
						trigger: (
							<span className="flex items-baseline composition-gap-control">
								<ChainMark glyph="pass" size={12} tone="ok" />
								<span className="tone-success">{`${branches.length} ${noun} passed`}</span>
							</span>
						),
					}}
					panelVariant="bordered"
				>
					{branches.map((branch) => (
						<div
							className="rule-row composition-inline-inset branch-compact-row-inset"
							key={branch.id}
						>
							<Collapsible
								panelVariant="bordered"
								summary={`${branch.passed.length} passed`}
								trigger={branch.name}
								triggerTone="quiet"
							>
								<BranchBody branch={branch} context={context} />
							</Collapsible>
						</div>
					))}
				</Collapsible>
			</div>
		</Card>
	);
}
