import type {
	EveryUnit,
	InactiveUnit,
	ScheduleDraft,
	ScheduleState,
	ScheduleStep,
	ThreadSubject,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	DURATION_UNIT_MS,
	MAX_INACTIVE_FOR_MS,
	MAX_SCHEDULE_EVERY_MS,
	missingScheduleSteps,
	NEW_SCHEDULE_DRAFT,
} from "@tripwire/contracts";
import { type ReactNode, useId, useRef, useState } from "react";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import {
	Field,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
	Label,
} from "#/components/glaze/ui/field";
import { NumberInput } from "#/components/glaze/ui/number-input";
import {
	RadioGroup,
	RadioGroupOption,
} from "#/components/glaze/ui/radio-group";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { Select } from "#/components/glaze/ui/select";
import { LabelPicker } from "#/components/workflows/editor/label-picker";
import { cn } from "#/lib/glaze/utils";
import { scheduleSentence, UNIT_LABEL } from "#/lib/schedule-summary";
import {
	EVENT_KIND_OPTIONS,
	eventSentence,
	switchTriggerPath,
	type TriggerPath,
	toggleTriggerKind,
	triggerPath,
} from "#/lib/trigger-kinds";

type StepStatus = "answered" | "current" | "upcoming";

const EVERY_UNITS: readonly EveryUnit[] = ["hours", "days", "weeks"];
const INACTIVE_UNITS: readonly InactiveUnit[] = [
	"hours",
	"days",
	"weeks",
	"months",
];

const SUBJECT_OPTIONS: { value: ThreadSubject; label: string }[] = [
	{ value: "issue", label: "Issues" },
	{ value: "change-request", label: "Change requests" },
];

const STATE_OPTIONS: { value: ScheduleState; label: string }[] = [
	{ value: "open", label: "Open" },
	{ value: "closed", label: "Closed" },
	{ value: "any", label: "Any" },
];

const FOCUSABLE =
	"input:not([type=hidden]):not([aria-hidden=true]), select, textarea, [role=checkbox], [role=radio]";

function maxFor(unit: keyof typeof DURATION_UNIT_MS, limitMs: number): number {
	return Math.floor(limitMs / DURATION_UNIT_MS[unit]);
}

function TriggerSummary({
	node,
}: {
	node: Extract<WorkflowNode, { type: "trigger" }>;
}) {
	const parts =
		triggerPath(node) === "schedule"
			? scheduleSentence(node.schedule ?? NEW_SCHEDULE_DRAFT)
			: eventSentence(node.kinds);
	return (
		<p aria-live="polite" className="type-body text-text-1">
			{parts.map((part) =>
				part.placeholder ? (
					<span
						className="text-text-3 underline decoration-dotted underline-offset-4"
						key={part.key}
					>
						{part.text}
					</span>
				) : (
					<span key={part.key}>{part.text}</span>
				),
			)}
		</p>
	);
}

function Step({
	step,
	status,
	children,
}: {
	step: string;
	status: StepStatus;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-2 border-s-2 ps-3 transition-[border-color,opacity] duration-200",
				status === "current" ? "border-line-focus" : "border-line-faint",
				status === "upcoming" && "opacity-60",
			)}
			data-field={step}
			data-status={status}
			data-step={step}
		>
			{children}
		</div>
	);
}

function stepLabelClass(status: StepStatus): string {
	return cn(
		"transition-colors duration-200",
		status === "current" && "text-text-1",
		status === "answered" && "text-text-2",
		status === "upcoming" && "text-text-3",
	);
}

function DurationField<Unit extends keyof typeof DURATION_UNIT_MS>({
	label,
	status,
	value,
	units,
	defaultUnit,
	limitMs,
	readOnly,
	onChange,
}: {
	label: string;
	status: StepStatus;
	value: { n: number; unit: Unit } | undefined;
	units: readonly Unit[];
	defaultUnit: Unit;
	limitMs: number;
	readOnly: boolean;
	onChange: (next: { n: number; unit: Unit } | undefined) => void;
}) {
	const [pendingUnit, setPendingUnit] = useState<Unit>(defaultUnit);
	const unit = value?.unit ?? pendingUnit;
	const max = maxFor(unit, limitMs);
	const unitLabelId = useId();
	return (
		<Field>
			<FieldLabel className={stepLabelClass(status)}>{label}</FieldLabel>
			<div className="flex items-center gap-2">
				<NumberInput
					className="min-w-0 flex-1"
					disabled={readOnly}
					max={max}
					min={1}
					onValueChange={(next) =>
						onChange(next === null ? undefined : { n: next, unit })
					}
					value={value?.n ?? null}
				/>
				<span className="sr-only" id={unitLabelId}>
					Unit
				</span>
				<Select
					aria-labelledby={unitLabelId}
					className="w-28 shrink-0"
					disabled={readOnly}
					items={units.map((entry) => ({
						value: entry,
						label: UNIT_LABEL[entry],
					}))}
					native
					onValueChange={(next) => {
						if (!next) {
							return;
						}
						const nextUnit = next as Unit;
						setPendingUnit(nextUnit);
						if (value) {
							onChange({
								n: Math.min(value.n, maxFor(nextUnit, limitMs)),
								unit: nextUnit,
							});
						}
					}}
					value={unit}
				/>
			</div>
		</Field>
	);
}

function ScheduleFlow({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "trigger" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	const draft = node.schedule ?? NEW_SCHEDULE_DRAFT;
	const missing = missingScheduleSteps(draft);
	const current = missing[0] ?? null;
	const statusOf = (step: ScheduleStep): StepStatus =>
		!missing.includes(step)
			? "answered"
			: step === current
				? "current"
				: "upcoming";
	const root = useRef<HTMLDivElement>(null);
	const byPointer = useRef(false);
	const subjectsTitleId = useId();
	const stateTitleId = useId();

	const focusStep = (step: ScheduleStep) => {
		const scope = root.current?.querySelector(`[data-step="${step}"]`);
		scope?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
	};

	const update = (next: ScheduleDraft, answered?: ScheduleStep) => {
		onUpdate({ ...node, schedule: next });
		const advance = byPointer.current && answered && missing.includes(answered);
		byPointer.current = false;
		if (!advance) {
			return;
		}
		const upNext = missingScheduleSteps(next)[0];
		if (upNext) {
			requestAnimationFrame(() => focusStep(upNext));
		}
	};
	const setMatch = (
		patch: Partial<ScheduleDraft["match"]>,
		answered?: ScheduleStep,
	) => update({ ...draft, match: { ...draft.match, ...patch } }, answered);

	const labels = draft.match.labels ?? [];
	const excludeLabels = draft.match.excludeLabels ?? [];

	return (
		<div
			className="flex flex-col gap-4"
			data-field="schedule"
			onKeyDownCapture={() => {
				byPointer.current = false;
			}}
			onPointerDownCapture={() => {
				byPointer.current = true;
			}}
			ref={root}
		>
			<Step status={statusOf("every")} step="every">
				<DurationField
					defaultUnit="hours"
					label="Runs every"
					limitMs={MAX_SCHEDULE_EVERY_MS}
					onChange={(every) => update({ ...draft, every }, "every")}
					readOnly={readOnly}
					status={statusOf("every")}
					units={EVERY_UNITS}
					value={draft.every}
				/>
			</Step>
			<Step status={statusOf("subjects")} step="subjects">
				<FieldTitle
					className={stepLabelClass(statusOf("subjects"))}
					id={subjectsTitleId}
				>
					Looks at
				</FieldTitle>
				<fieldset
					aria-labelledby={subjectsTitleId}
					className="flex min-w-0 flex-col gap-2"
				>
					{SUBJECT_OPTIONS.map((option) => {
						const chosen = draft.match.subjects ?? [];
						return (
							<Label className="flex items-center gap-2" key={option.value}>
								<Checkbox
									checked={chosen.includes(option.value)}
									disabled={readOnly}
									onCheckedChange={(checked) =>
										setMatch(
											{
												subjects: SUBJECT_OPTIONS.map((o) => o.value).filter(
													(subject) =>
														subject === option.value
															? checked
															: chosen.includes(subject),
												),
											},
											"subjects",
										)
									}
								/>
								{option.label}
							</Label>
						);
					})}
				</fieldset>
			</Step>
			<Step status={statusOf("state")} step="state">
				<FieldTitle
					className={stepLabelClass(statusOf("state"))}
					id={stateTitleId}
				>
					That are
				</FieldTitle>
				<SegmentedControl
					aria-labelledby={stateTitleId}
					disabled={readOnly}
					fill
					onValueChange={(next) =>
						setMatch({ state: next as ScheduleState }, "state")
					}
					value={draft.match.state ?? ""}
				>
					{STATE_OPTIONS.map((option) => (
						<SegmentedControlItem key={option.value} value={option.value}>
							{option.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</Step>
			<Step status={statusOf("inactiveFor")} step="inactiveFor">
				<DurationField
					defaultUnit="days"
					label="With no activity for"
					limitMs={MAX_INACTIVE_FOR_MS}
					onChange={(inactiveFor) => setMatch({ inactiveFor }, "inactiveFor")}
					readOnly={readOnly}
					status={statusOf("inactiveFor")}
					units={INACTIVE_UNITS}
					value={draft.match.inactiveFor}
				/>
			</Step>
			<FieldSet className="gap-3 border-line-faint border-t pt-4">
				<FieldLegend variant="label">Narrow it down</FieldLegend>
				<Field data-field="labels">
					<FieldLabel>Has all of these labels</FieldLabel>
					<LabelPicker
						onChange={(next) =>
							setMatch({ labels: next.length > 0 ? next : undefined })
						}
						readOnly={readOnly}
						value={labels}
					/>
				</Field>
				<Field data-field="excludeLabels">
					<FieldLabel>Has none of these labels</FieldLabel>
					<LabelPicker
						onChange={(next) =>
							setMatch({ excludeLabels: next.length > 0 ? next : undefined })
						}
						readOnly={readOnly}
						value={excludeLabels}
					/>
				</Field>
				<Label className="flex items-center gap-2">
					<Checkbox
						checked={draft.match.skipLocked !== false}
						disabled={readOnly}
						onCheckedChange={(checked) => setMatch({ skipLocked: checked })}
					/>
					Skip locked threads
				</Label>
			</FieldSet>
		</div>
	);
}

export function TriggerFlow({
	node,
	readOnly,
	onUpdate,
}: {
	node: Extract<WorkflowNode, { type: "trigger" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
}) {
	const path = triggerPath(node);
	const root = useRef<HTMLDivElement>(null);
	const byPointer = useRef(false);
	const startsTitleId = useId();
	const eventsTitleId = useId();
	const choosePath = (next: TriggerPath) => {
		const advance = byPointer.current && next !== path;
		byPointer.current = false;
		onUpdate(switchTriggerPath(node, next));
		if (advance) {
			requestAnimationFrame(() => {
				const scope = root.current?.querySelector(
					`[data-step="${next === "schedule" ? "every" : "kinds"}"]`,
				);
				scope?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
			});
		}
	};
	return (
		<div
			className="flex flex-col gap-4"
			onKeyDownCapture={() => {
				byPointer.current = false;
			}}
			onPointerDownCapture={() => {
				byPointer.current = true;
			}}
			ref={root}
		>
			<TriggerSummary node={node} />
			<Step status="answered" step="starts">
				<FieldTitle className={stepLabelClass("answered")} id={startsTitleId}>
					Starts
				</FieldTitle>
				<RadioGroup
					aria-labelledby={startsTitleId}
					className="gap-2"
					disabled={readOnly}
					onValueChange={(next) => choosePath(next as TriggerPath)}
					value={path}
				>
					<RadioGroupOption label="When something happens" value="event" />
					<RadioGroupOption label="On a schedule" value="schedule" />
				</RadioGroup>
			</Step>
			{path === "event" ? (
				<Step
					status={node.kinds.length > 0 ? "answered" : "current"}
					step="kinds"
				>
					<fieldset
						aria-labelledby={eventsTitleId}
						className="flex min-w-0 flex-col gap-2"
						data-field="kinds"
					>
						<FieldTitle
							className={stepLabelClass(
								node.kinds.length > 0 ? "answered" : "current",
							)}
							id={eventsTitleId}
						>
							Runs on these events
						</FieldTitle>
						{EVENT_KIND_OPTIONS.map((entry) => (
							<Label className="flex items-center gap-2" key={entry.kind}>
								<Checkbox
									checked={node.kinds.includes(entry.kind)}
									disabled={readOnly}
									onCheckedChange={(checked) =>
										onUpdate(toggleTriggerKind(node, entry.kind, checked))
									}
								/>
								{entry.name}
							</Label>
						))}
					</fieldset>
				</Step>
			) : (
				<ScheduleFlow node={node} onUpdate={onUpdate} readOnly={readOnly} />
			)}
		</div>
	);
}
