import type { ScheduleCadence, ScheduleToken } from "@tripwire/contracts";
import {
	completeScheduleText,
	DEFAULT_SCHEDULE_TIMEZONE,
	describeSchedule,
	parseScheduleText,
	scheduleText,
	scheduleZoneWord,
	zoneOffsetLabel,
} from "@tripwire/contracts";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
} from "@tripwire/ui/field";
import { Caption } from "@tripwire/ui/typography";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ScheduleTokenHint } from "#/components/layouts/schedule-token-hint";
import { useMinuteClock } from "#/hooks/use-minute-clock";
import type { Timezones } from "#/hooks/use-timezones";
import {
	editorNextRun,
	formatNextRun,
	type SavedScheduleTiming,
	showsScheduleZone,
	typedScheduleCommit,
} from "#/lib/schedule-input";

export interface CadenceValue {
	every: ScheduleCadence | undefined;
	timezone: string | undefined;
}

const LIVE_PROBLEMS = new Set(["floor", "ambiguous", "unstorable", "invalid"]);

function NextRun({ next, display }: { next: Date | null; display: string }) {
	if (!next) {
		return null;
	}
	return <Caption>Next {formatNextRun(next, display)}</Caption>;
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
				<span data-layout-role="schedule-text-gap" key={`gap-${cursor}`}>
					{text.slice(cursor, token.from)}
				</span>,
			);
		}
		parts.push(
			<span
				data-active={(active === index && token.tone === "ok") || undefined}
				data-layout-role="schedule-token"
				data-token-tone={token.tone}
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
			<span data-layout-role="schedule-text-gap" key={`gap-${cursor}`}>
				{text.slice(cursor)}
			</span>,
		);
	}
	return (
		<>
			{parts}
			{ghost ? (
				<span data-layout-role="schedule-completion">{ghost}</span>
			) : null}
		</>
	);
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
	const now = useMinuteClock();
	const input = useRef<HTMLInputElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const mirror = useRef<HTMLSpanElement>(null);
	const spans = useRef<(HTMLSpanElement | null)[]>([]);
	const [focused, setFocused] = useState(false);
	const [caret, setCaret] = useState<number | null>(null);
	const [hovered, setHovered] = useState<number | null>(null);
	const [scroll, setScroll] = useState(0);

	useLayoutEffect(() => {
		if (mirror.current) mirror.current.scrollLeft = scroll;
	});

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
	const zone =
		(parsed.ok ? parsed.timezone : undefined) ??
		value.timezone ??
		timezones.newSchedule ??
		DEFAULT_SCHEDULE_TIMEZONE;
	const showZone = showsScheduleZone(text, parsed);

	const commit = (next: string) => {
		onDraft(next);
		const committed = typedScheduleCommit(next, {
			saved: savedTiming.saved,
			current: value,
			newZone: timezones.newSchedule,
		});
		if (committed) {
			onChange(committed);
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

	const next = value.every
		? editorNextRun(
				{ every: value.every, timezone: value.timezone },
				{ ...savedTiming, now },
			)
		: null;
	const zoneLabel = zoneOffsetLabel(zone, next ?? undefined);
	const described = parsed.ok
		? describeSchedule({ every: parsed.every, timezone: zone })
		: "";

	return (
		<div className="relative" data-field="every">
			<Field invalid={problem !== null}>
				<div data-layout-role="schedule-field-heading">
					<FieldLabel>When</FieldLabel>
					{parsed.ok || problem === null ? (
						<NextRun display={timezones.display.zone} next={next} />
					) : null}
				</div>
				<div className="relative" ref={box}>
					<div
						className="relative"
						data-layout-role="schedule-input"
						data-schedule-problem={problem?.reason}
						onPointerLeave={() => setHovered(null)}
						onPointerMove={onPointerMove}
						onScrollCapture={(event) => {
							if (event.target === input.current) track();
						}}
						onSelectCapture={track}
					>
						<span className="relative flex h-full min-w-0 flex-1 items-center overflow-hidden">
							<span aria-hidden data-layout-role="schedule-mirror" ref={mirror}>
								<span data-layout-role="schedule-mirror-text">
									<Segments
										active={active}
										ghost={ghost}
										spans={spans}
										text={text}
										tokens={tokens}
									/>
								</span>
							</span>
							<Input
								ariaLabel="Schedule"
								autoComplete="off"
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
								placeholder="every 5 days"
								readOnly={readOnly}
								ref={input}
								value={text}
							/>
						</span>
						{showZone ? (
							<span
								aria-hidden
								data-layout-role="schedule-timezone"
								title={zoneLabel}
							>
								{scheduleZoneWord(zone)}
							</span>
						) : null}
					</div>
					{activeToken && activeToken.kind !== "unknown" ? (
						<ScheduleTokenHint
							field={box}
							hasProblem={problem !== null}
							label={activeToken.label}
							tokenIndex={active}
							tokens={spans}
							scrollContainer={mirror}
						/>
					) : null}
					<output aria-live="polite" className="block">
						{problem ? (
							<FieldError
								data-layout-role="schedule-problem"
								data-schedule-problem={problem.reason}
							>
								{problem.message}
							</FieldError>
						) : null}
					</output>
					{problem && problem.fixes.length > 0 && !readOnly ? (
						<div data-layout-role="schedule-fixes">
							{problem.fixes.map((fix) => (
								<button
									className="focus-sm"
									data-layout-role="schedule-fix"
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
					<span className="sr-only">
						<FieldDescription>{described}</FieldDescription>
					</span>
				) : null}
			</Field>
		</div>
	);
}
