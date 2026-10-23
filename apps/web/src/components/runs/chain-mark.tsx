import type { ReactNode } from "react";
import {
	Blocked,
	ChangeRequest,
	Check,
	Close,
	Comment,
	Commit,
	FailedMark,
	type GlazeIcon,
	Icon,
	Negate,
	Pending,
	Retry,
	Subtract,
	Success,
	Time,
	Undo,
	Waiting,
	Warning,
} from "#/components/glaze/icon";
import type { ChainGlyph, ChainTone } from "#/lib/run-chain";
import { cn } from "#/lib/utils";

const RING_GLYPH = {
	opened: ChangeRequest,
	pushed: Commit,
	rerun: Retry,
	scheduled: Time,
	comment: Comment,
	pass: Success,
	fail: FailedMark,
	blocked: Blocked,
	skipped: Negate,
	waiting: Waiting,
	running: Pending,
	errored: Warning,
	superseded: Undo,
	ran: Check,
} satisfies Record<ChainGlyph, GlazeIcon>;

const NODE_GLYPH = {
	...RING_GLYPH,
	pass: Check,
	fail: Close,
	skipped: Subtract,
} satisfies Record<ChainGlyph, GlazeIcon>;

const TONE_TEXT = {
	ok: "text-ok",
	fail: "text-fail",
	neutral: "text-text-2",
} satisfies Record<ChainTone, string>;

export const TONE_WORD = {
	ok: "text-ok-text",
	fail: "text-fail-text",
	neutral: "text-text-1",
} satisfies Record<ChainTone, string>;

export function ChainMark({
	glyph,
	tone,
	size = 14,
}: {
	glyph: ChainGlyph;
	tone: ChainTone;
	size?: 12 | 14;
}) {
	return (
		<span className="flex h-lh shrink-0 items-center">
			<Icon
				className={cn(
					TONE_TEXT[tone],
					glyph === "running" && "animate-spin motion-reduce:animate-none",
				)}
				icon={RING_GLYPH[glyph]}
				size={size}
			/>
		</span>
	);
}

const NODE_SURFACE = {
	ok: "border-ok/35 bg-ok-tint text-ok",
	fail: "border-fail/35 bg-fail-tint text-fail",
	neutral: "border-line bg-paper text-text-2",
} satisfies Record<ChainTone, string>;

const NODE_SOLID = {
	ok: "bg-ok text-page",
	fail: "bg-fail text-page",
	neutral: "bg-ink text-page",
} satisfies Record<ChainTone, string>;

export function ChainNode({
	glyph,
	tone,
	solid = false,
}: {
	glyph: ChainGlyph;
	tone: ChainTone;
	solid?: boolean;
}) {
	return (
		<span
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-pill",
				solid ? NODE_SOLID[tone] : cn("border", NODE_SURFACE[tone]),
			)}
		>
			<Icon
				className={cn(
					glyph === "running" && "animate-spin motion-reduce:animate-none",
				)}
				icon={NODE_GLYPH[glyph]}
				size={12}
				weight={solid ? "bold" : "regular"}
			/>
		</span>
	);
}

export function ChainRow({
	node,
	line = true,
	children,
	className,
}: {
	node: ReactNode;
	line?: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<li className="flex gap-4">
			<div className="flex w-6 shrink-0 flex-col items-center">
				{node}
				{line ? <span aria-hidden className="w-px grow bg-line" /> : null}
			</div>
			<div className={cn("flex min-w-0 flex-1 flex-col gap-1 pb-8", className)}>
				{children}
			</div>
		</li>
	);
}
