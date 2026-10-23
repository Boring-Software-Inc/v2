import type {
	ScheduleCadence,
	ScheduleTextParse,
	ScheduleToken,
} from "@tripwire/contracts";
import {
	completeScheduleText,
	DEFAULT_SCHEDULE_TIMEZONE,
	parseScheduleText,
	scheduleText,
	scheduleZoneWord,
	zoneOffsetLabel,
} from "@tripwire/contracts";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
import {
	InputControl,
	InputRoot,
	InputTrailing,
} from "#/components/glaze/ui/input";
import { TooltipChip } from "#/components/glaze/ui/tooltip";
import type { Timezones } from "#/hooks/use-timezones";
import { cn } from "#/lib/glaze/utils";
import {
	committedSchedule,
	editorNextRun,
	formatNextRun,
	isClockCadence,
	type SavedScheduleTiming,
} from "#/lib/schedule-input";

export interface CadenceValue {
	every: ScheduleCadence | undefined;
	timezone: string | undefined;
}

const LIVE_PROBLEMS = new Set(["floor", "ambiguous", "unstorable", "invalid"]);

const TOKEN_TONE = {
	ok: "bg-hover text-text-1",
	warn: "bg-warn-tint text-warn-text",
	fail: "bg-fail-tint text-fail-text",
} as const;

function NextRun({ next, display }: { next: Date | null; display: string }) {
	if (!next) {
		return null;
	}
	return (
		<span className="type-caption text-text-2 tabular-nums">
			Next {formatNextRun(next, display)}
		</span>
	);
}

function Segments({
	text,
	tokens,
	active,
	ghost,
	spans,
}: {
	text: string;
	tokens: readonly ScheduleToken[];
	active: number | null;
	ghost: string | null;
	spans: RefObject<(HTMLSpanElement | null)[]>;
}) {
	const parts: ReactNode[] = [];
	let cursor = 0;
	tokens.forEach((token, index) => {
		if (token.from > cursor) {
			parts.push(
				<span className="text-text-1" key={`gap-${cursor}`}>
					{text.slice(cursor, token.from)}
				</span>,
			);
		}
		parts.push(
			<span
				className={cn(
					"-mx-px rounded-tag px-px transition-colors duration-(--dur-state)",
					TOKEN_TONE[token.tone],
					active === index && token.tone === "ok" && "bg-pressed",
				)}
				data-token={token.kind}
				key={`token-${token.from}`}
				ref={(element) => {
					spans.current[index] = element;
				}}
			>
				{text.slice(token.from, token.to)}
			</span>,
		);
		cursor = token.to;
	});
	if (cursor < text.length) {
		parts.push(
			<span className="text-text-1" key={`gap-${cursor}`}>
				{text.slice(cursor)}
			</span>,
		);
	}
	return (
		<>
			{parts}
			{ghost ? <span className="text-text-3">{ghost}</span> : null}
		</>
	);
}

function readBack(parsed: ScheduleTextParse): string {
	return parsed.tokens
		.filter((token) => token.tone === "ok" && token.kind !== "unknown")
		.map((token) => token.label)
		.join(", ");
}

export function ScheduleTextField({
	value,
	readOnly,
	savedTiming,
	timezones,
	draft,
	onDraft,
	onChange,
}: {
	value: CadenceValue;
	readOnly: boolean;
	savedTiming: SavedScheduleTiming;
	timezones: Timezones;
	draft: string | undefined;
	onDraft: (text: string | null) => void;
	onChange: (next: CadenceValue) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const spans = useRef<(HTMLSpanElement | null)[]>([]);
	const [focused, setFocused] = useState(false);
	const [caret, setCaret] = useState<number | null>(null);
	const [hovered, setHovered] = useState<number | null>(null);
	const [scroll, setScroll] = useState(0);

	const saved = value.every
		? scheduleText({ every: value.every, timezone: value.timezone })
		: "";
	const text = draft ?? saved;
	const parsed = useMemo(() => parseScheduleText(text), [text]);
	const atEnd = caret === text.length;
	const ghost =
		focused && atEnd && !readOnly ? completeScheduleText(text) : null;
	const problem =
		!parsed.ok &&
		parsed.reason !== "empty" &&
		(!focused || LIVE_PROBLEMS.has(parsed.reason))
			? parsed
			: null;
	const tokens = parsed.tokens;
	const caretToken = focused
		? tokens.findIndex(
				(token) => caret !== null && caret > token.from && caret <= token.to,
			)
		: -1;
	const active =
		hovered ?? (caretToken >= 0 && problem === null ? caretToken : null);
	const activeToken = active === null ? undefined : tokens[active];
	const hasZone = tokens.some((token) => token.kind === "zone");
	const intervalOnly =
		parsed.ok && !isClockCadence(parsed.every)
			? true
			: tokens.some((token) => token.kind === "interval");
	const zone =
		(parsed.ok ? parsed.timezone : undefined) ??
		value.timezone ??
		timezones.newSchedule ??
		DEFAULT_SCHEDULE_TIMEZONE;
	const showZone = text.trim() !== "" && !hasZone && !intervalOnly;

	const commit = (next: string) => {
		onDraft(next);
		const result = parseScheduleText(next);
		if (result.ok) {
			onChange(
				committedSchedule(value, {
					every: result.every,
					timezone:
						result.timezone ??
						(isClockCadence(result.every)
							? (value.timezone ?? timezones.newSchedule)
							: undefined),
				}),
			);
		} else if (result.reason === "empty") {
			onChange({ every: undefined, timezone: undefined });
		}
	};

	const track = () => {
		const element = input.current;
		if (!element) {
			return;
		}
		setCaret(
			element.selectionStart === element.selectionEnd
				? element.selectionStart
				: null,
		);
		setScroll(element.scrollLeft);
	};

	const accept = (next: string) => {
		commit(next);
		requestAnimationFrame(() => {
			const element = input.current;
			if (element) {
				element.focus();
				element.setSelectionRange(next.length, next.length);
				track();
			}
		});
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Tab" && !event.shiftKey && ghost) {
			event.preventDefault();
			accept(text + ghost);
		}
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const index = spans.current.findIndex((span, at) => {
			if (!span || at >= tokens.length) {
				return false;
			}
			const rect = span.getBoundingClientRect();
			return event.clientX >= rect.left && event.clientX <= rect.right;
		});
		setHovered(index >= 0 ? index : null);
	};

	const chipPlace = (() => {
		const span = active === null ? null : spans.current[active];
		const root = box.current;
		if (!(span && root)) {
			return { left: 0 };
		}
		const field = root.getBoundingClientRect();
		const word = span.getBoundingClientRect();
		const left = Math.max(word.left - field.left, 0);
		return left > field.width / 2
			? { right: Math.max(field.right - word.right, 0) }
			: { left };
	})();

	const next = value.every
		? editorNextRun(
				{ every: value.every, timezone: value.timezone },
				{ ...savedTiming, now: new Date() },
			)
		: null;
	const zoneLabel = zoneOffsetLabel(zone, next ?? undefined);
	const described = parsed.ok ? readBack(parsed) : "";

	return (
		<Field className="relative" data-field="every" invalid={problem !== null}>
			<div className="flex items-baseline justify-between gap-2">
				<FieldLabel>When</FieldLabel>
				{parsed.ok || problem === null ? (
					<NextRun display={timezones.display.zone} next={next} />
				) : null}
			</div>
			<div className="relative" ref={box}>
				<InputRoot
					className={cn(
						problem?.reason === "ambiguous" && "border-warn!",
						"relative",
					)}
					disabled={readOnly}
					onPointerLeave={() => setHovered(null)}
					onPointerMove={onPointerMove}
					readOnly={readOnly}
				>
					<span className="relative flex h-full min-w-0 flex-1 items-center overflow-hidden">
						<span
							aria-hidden
							className="pointer-events-none absolute inset-y-0 start-0 flex items-center whitespace-pre"
							style={{ transform: `translateX(${-scroll}px)` }}
						>
							<Segments
								active={active}
								ghost={ghost}
								spans={spans}
								text={text}
								tokens={tokens}
							/>
						</span>
						<InputControl
							autoCapitalize="off"
							autoComplete="off"
							autoCorrect="off"
							className="relative text-clip text-transparent caret-text-1 selection:bg-pressed"
							onBlur={() => {
								setFocused(false);
								setCaret(null);
								if (parsed.ok || parsed.reason === "empty") {
									onDraft(null);
								}
							}}
							onChange={(event) => {
								commit(event.target.value);
								setCaret(event.target.selectionStart);
								setScroll(event.target.scrollLeft);
							}}
							onFocus={() => {
								setFocused(true);
								requestAnimationFrame(track);
							}}
							onKeyDown={onKeyDown}
							onKeyUp={track}
							onScroll={track}
							onSelect={track}
							placeholder="every 5 days"
							readOnly={readOnly}
							ref={input}
							spellCheck={false}
							value={text}
						/>
					</span>
					{showZone ? (
						<InputTrailing
							aria-hidden
							className="text-text-3"
							title={zoneLabel}
						>
							{scheduleZoneWord(zone)}
						</InputTrailing>
					) : null}
				</InputRoot>
				{activeToken && activeToken.kind !== "unknown" ? (
					<TooltipChip
						className={cn(
							"pointer-events-none absolute z-(--z-raised) whitespace-nowrap",
							problem ? "bottom-full mb-1" : "top-full mt-1",
						)}
						style={chipPlace}
					>
						{activeToken.label}
					</TooltipChip>
				) : null}
				<output aria-live="polite" className="block">
					{problem ? (
						<FieldError
							className={cn(
								"mt-1.5",
								problem.reason === "ambiguous" && "text-warn-text",
							)}
						>
							{problem.message}
						</FieldError>
					) : null}
				</output>
				{problem && problem.fixes.length > 0 && !readOnly ? (
					<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
						{problem.fixes.map((fix) => (
							<button
								className="type-caption font-medium text-text-1 underline decoration-1 underline-offset-2 rounded-tag hover:text-text-2 focus-sm"
								key={fix.label}
								onClick={() => accept(fix.text)}
								type="button"
							>
								{fix.label}
							</button>
						))}
					</div>
				) : null}
			</div>
			{described ? (
				<FieldDescription className="sr-only">
					{showZone ? `${described}, ${zoneLabel}` : described}
				</FieldDescription>
			) : null}
		</Field>
	);
}
