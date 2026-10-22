import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
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
import {
	ChainMark,
	ChainNode,
	ChainRow,
	TONE_WORD,
} from "#/components/runs/chain-mark";
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

const clock = new Intl.DateTimeFormat("en-GB", {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function ClockTime({ at }: { at: string }) {
	return (
		<time dateTime={at} suppressHydrationWarning>
			{clock.format(new Date(at))}
		</time>
	);
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

const COLUMN_CENTERS = [
	"calc(40px + (100% - 56px) / 4)",
	"calc(56px + 3 * (100% - 56px) / 4)",
];

function Fork({ merge = false }: { merge?: boolean }) {
	return (
		<div aria-hidden className="relative hidden h-6 md:block">
			{COLUMN_CENTERS.map((center) => (
				<span
					className="contents"
					key={center}
					style={{ "--fork-x": center } as CSSProperties}
				>
					{merge ? (
						<>
							<span className="absolute start-[calc(var(--fork-x)-8px)] top-0 h-2.5 w-2 rounded-ee-tag border-e border-b border-line" />
							<span className="absolute start-3 top-2 bottom-0 w-[calc(var(--fork-x)-20px)] rounded-ss-tag border-s border-t border-line" />
						</>
					) : (
						<>
							<span className="absolute start-3 top-0 h-3.5 w-[calc(var(--fork-x)-20px)] rounded-es-tag border-s border-b border-line" />
							<span className="absolute start-[calc(var(--fork-x)-8px)] top-3 bottom-0 w-2 rounded-se-tag border-e border-t border-line" />
						</>
					)}
				</span>
			))}
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
	return (
		<li className="relative">
			<span
				aria-hidden
				className="absolute inset-y-0 start-3 w-px bg-line md:hidden"
			/>
			<Fork />
			<div className="grid gap-4 ps-10 pb-8 md:grid-cols-2 md:pb-0">
				{branches.map((branch) => (
					<div className="flex min-w-0 flex-col items-center" key={branch.id}>
						<BranchItem
							branch={branch}
							className="w-full"
							context={context}
							showOutcome={showOutcome}
						/>
						<span aria-hidden className="hidden w-px grow bg-line md:block" />
					</div>
				))}
			</div>
			<Fork merge />
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
