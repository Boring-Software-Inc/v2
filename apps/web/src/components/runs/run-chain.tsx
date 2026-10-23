import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	ArrowUpRight,
	Comment,
	Document,
	FailedMark,
	type GlazeIcon,
	Icon,
	Pending,
	Send,
	Success,
	Undo,
	Workflow,
} from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	BranchCard,
	type BranchContext,
	BranchRow,
	PassedGroup,
} from "#/components/runs/branch-card";
import { BranchConnector } from "#/components/runs/branch-connector";
import {
	ChainMark,
	ChainNode,
	ChainRow,
	TONE_WORD,
} from "#/components/runs/chain-mark";
import { ZonedTime } from "#/components/timezones/zoned-time";
import {
	type ChainBranch,
	type ChainChecks,
	type ChainChip,
	type ChainOutcome,
	formatOffset,
	type RuleMark,
	type RunChain,
} from "#/lib/run-chain";
import { cn } from "#/lib/utils";

function ClockTime({ at }: { at: string }) {
	return <ZonedTime at={at} format="clock" />;
}

function When({
	at,
	offsetMs,
}: {
	at: string | null;
	offsetMs: number | null;
}) {
	if (!at && offsetMs === null) {
		return null;
	}
	return (
		<span className="type-caption text-text-2">
			{at ? <ClockTime at={at} /> : null}
			{at && offsetMs !== null ? ", " : null}
			{offsetMs !== null ? formatOffset(offsetMs) : null}
		</span>
	);
}

function NodeTitle({
	title,
	at,
	offsetMs,
	size = "default",
	className,
}: {
	title: string;
	at: string | null;
	offsetMs: number | null;
	size?: "default" | "outcome";
	className?: string;
}) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-2">
			<h2
				className={cn(
					size === "outcome" ? "type-heading" : "type-label-lg",
					className ?? "text-text-1",
				)}
			>
				{title}
			</h2>
			<When at={at} offsetMs={offsetMs} />
		</div>
	);
}

const MARK_GLYPH = {
	pass: "pass",
	fail: "fail",
	skipped: "skipped",
	pending: "running",
} satisfies Record<RuleMark, "pass" | "fail" | "skipped" | "running">;

const MARK_TONE = {
	pass: "ok",
	fail: "fail",
	skipped: "neutral",
	pending: "neutral",
} satisfies Record<RuleMark, "ok" | "fail" | "neutral">;

function Marks({ marks }: { marks: RuleMark[] }) {
	return (
		<ol aria-label="Checks in run order" className="flex flex-wrap gap-1.5">
			{marks.map((mark, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: marks have no identity beyond their order
				<li key={index}>
					<ChainMark glyph={MARK_GLYPH[mark]} tone={MARK_TONE[mark]} />
					<span className="sr-only">{mark}</span>
				</li>
			))}
		</ol>
	);
}

function BranchItem({
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
	return branch.form === "row" ? (
		<BranchRow branch={branch} context={context} />
	) : (
		<BranchCard
			branch={branch}
			className={className}
			context={context}
			showOutcome={showOutcome}
		/>
	);
}

function StackedBranches({
	checks,
	context,
}: {
	checks: ChainChecks;
	context: BranchContext;
}) {
	const body = checks.body;
	if (body.kind === "marks") {
		return <Marks marks={body.marks} />;
	}
	if (body.kind !== "branches") {
		return null;
	}
	return (
		<div className="flex max-w-140 flex-col gap-4 pt-3">
			{body.branches.map((branch) => (
				<BranchItem
					branch={branch}
					context={context}
					key={branch.id}
					showOutcome={body.showBranchOutcome}
				/>
			))}
			{body.passedGroup.length > 0 ? (
				<PassedGroup branches={body.passedGroup} context={context} />
			) : null}
		</div>
	);
}

function SideBySide({
	branches,
	context,
	showOutcome,
}: {
	branches: ChainBranch[];
	context: BranchContext;
	showOutcome: boolean;
}) {
	const [grid, setGrid] = useState<HTMLDivElement | null>(null);
	return (
		<li className="relative">
			<span
				aria-hidden
				className="absolute inset-y-0 start-0 flex w-6 justify-center md:hidden"
			>
				<span className="w-px bg-line" />
			</span>
			<BranchConnector grid={grid} />
			<div
				className="relative grid gap-4 ps-10 pb-8 md:grid-cols-2 md:py-6"
				ref={setGrid}
			>
				{branches.map((branch) => (
					<div className="min-w-0" key={branch.id}>
						<BranchItem
							branch={branch}
							className="w-full"
							context={context}
							showOutcome={showOutcome}
						/>
					</div>
				))}
			</div>
		</li>
	);
}

const CHIP_GLYPH = {
	pass: Success,
	fail: FailedMark,
	pending: Pending,
	review: Document,
	comment: Comment,
	send: Send,
	action: Workflow,
} satisfies Record<ChainChip["glyph"], GlazeIcon>;

const CHIP_TONE = {
	ok: "text-ok",
	fail: "text-fail",
	neutral: "text-text-2",
} satisfies Record<ChainChip["tone"], string>;

function OutcomeChip({ chip }: { chip: ChainChip }) {
	const glyph = (
		<Icon
			className={CHIP_TONE[chip.tone]}
			icon={CHIP_GLYPH[chip.glyph]}
			size={12}
		/>
	);
	if (!chip.href) {
		return (
			<Badge className="self-center" variant="outline">
				{glyph}
				{chip.label}
			</Badge>
		);
	}
	const href = chip.href;
	return (
		<Button
			nativeButton={false}
			render={(props) =>
				chip.internal ? (
					<Link {...props} params={{ runId: href }} to="/runs/$runId" />
				) : (
					<a {...props} href={href} rel="noreferrer" target="_blank" />
				)
			}
			size="sm"
			variant="secondary"
		>
			{glyph}
			{chip.label}
			<Icon className="text-text-3" icon={ArrowUpRight} size={12} />
		</Button>
	);
}

function OutcomeBody({ outcome }: { outcome: ChainOutcome }) {
	return (
		<>
			{outcome.detail ? (
				<p className="type-body-sm text-text-2">{outcome.detail}</p>
			) : null}
			{outcome.openReview ? (
				<div className="flex items-baseline gap-2 pt-2">
					<ChainMark glyph="waiting" tone="neutral" />
					<span className="type-label text-text-1">Human review open</span>
					{outcome.openReview.name ? (
						<span className="type-body-sm text-text-2">
							{outcome.openReview.name}
						</span>
					) : null}
				</div>
			) : null}
			{outcome.chips.length > 0 ? (
				<div className="flex flex-wrap gap-2 pt-2">
					{outcome.chips.map((chip) => (
						<OutcomeChip chip={chip} key={chip.key} />
					))}
				</div>
			) : null}
		</>
	);
}

export function RunChainView({
	chain,
	context,
}: {
	chain: RunChain;
	context: BranchContext;
}) {
	const { event, checks, steps, outcome } = chain;
	const side =
		checks?.body.kind === "branches" && checks.body.layout === "side"
			? checks.body
			: null;
	return (
		<ol className="flex flex-col">
			<ChainRow node={<ChainNode glyph={event.glyph} tone="neutral" />}>
				<NodeTitle at={event.at} offsetMs={null} title={event.title} />
				{event.detail ? (
					<p className="type-body-sm text-text-2">{event.detail}</p>
				) : null}
				{event.replaces ? (
					<p className="flex items-center gap-1.5 type-body-sm text-text-2">
						<Icon icon={Undo} size={12} />
						Replaces the run from
						<Link
							className="text-text-1 underline decoration-1 underline-offset-4"
							params={{ runId: event.replaces.id }}
							to="/runs/$runId"
						>
							<ClockTime at={event.replaces.createdAt} />
						</Link>
					</p>
				) : null}
			</ChainRow>
			{checks ? (
				<ChainRow
					className={side ? "pb-0" : undefined}
					line={!side}
					node={<ChainNode glyph={checks.glyph} tone={checks.tone} />}
				>
					<NodeTitle
						at={null}
						offsetMs={checks.offsetMs}
						title={checks.title}
					/>
					{side ? null : <StackedBranches checks={checks} context={context} />}
				</ChainRow>
			) : null}
			{side ? (
				<SideBySide
					branches={side.branches}
					context={context}
					showOutcome={side.showBranchOutcome}
				/>
			) : null}
			{steps.map((step) => (
				<ChainRow
					key={step.key}
					node={<ChainNode glyph={step.glyph} tone={step.tone} />}
				>
					<NodeTitle at={step.at} offsetMs={step.offsetMs} title={step.title} />
				</ChainRow>
			))}
			<ChainRow
				className="gap-2 pb-0"
				line={false}
				node={<ChainNode glyph={outcome.glyph} solid tone={outcome.tone} />}
			>
				<NodeTitle
					at={outcome.at}
					className={TONE_WORD[outcome.tone]}
					offsetMs={outcome.offsetMs}
					size="outcome"
					title={outcome.title}
				/>
				<OutcomeBody outcome={outcome} />
			</ChainRow>
		</ol>
	);
}

export function RunStatusMark({ outcome }: { outcome: ChainOutcome }) {
	return (
		<span className="flex items-baseline gap-1">
			<ChainMark
				glyph={outcome.glyph === "blocked" ? "fail" : outcome.glyph}
				tone={outcome.tone}
			/>
			<span className={cn("type-label", TONE_WORD[outcome.tone])}>
				{outcome.short}
			</span>
		</span>
	);
}
