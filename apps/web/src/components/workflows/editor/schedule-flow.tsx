import { useParams } from "@tanstack/react-router";
import type {
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
	missingScheduleSteps,
	NEW_SCHEDULE_DRAFT,
} from "@tripwire/contracts";
import { type ReactNode, useId, useRef, useState } from "react";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import {
	Field,
	FieldLabel,
	FieldTitle,
	Label,
} from "#/components/glaze/ui/field";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import {
	LabelPicker,
	RefreshLabels,
} from "#/components/workflows/editor/label-picker";
import { useScheduleDraft } from "#/components/workflows/editor/node-issues";
import { ScheduleTextField } from "#/components/workflows/editor/schedule-input";
import { useTimezones } from "#/hooks/use-timezones";
import { cn } from "#/lib/glaze/utils";
import { UNIT_LABEL } from "#/lib/schedule-summary";
import {
	EVENT_KIND_OPTIONS,
	switchTriggerPath,
	type TriggerPath,
	toggleTriggerKind,
	triggerPath,
	whenLabel,
} from "#/lib/trigger-kinds";

type StepStatus = "answered" | "current" | "upcoming";

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
	{ value: "any", label: "Either" },
];

const PATH_OPTIONS: { value: TriggerPath; label: string }[] = [
	{ value: "event", label: "On an event" },
	{ value: "schedule", label: "On a schedule" },
];

const FOCUSABLE =
	"input:not([type=hidden]):not([aria-hidden=true]), select, textarea, [role=checkbox], [role=radio]";

function maxFor(unit: keyof typeof DURATION_UNIT_MS, limitMs: number): number {
	return Math.floor(limitMs / DURATION_UNIT_MS[unit]);
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
				"flex flex-col gap-2 border-s-2 py-2 ps-3 transition-[border-color,opacity] duration-200",
				status === "current" ? "border-ink" : "border-line-faint",
				status === "upcoming" && "opacity-45",
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
		status === "current" ? "text-text-1" : "text-text-2",
	);
}

function StepTitle({
	status,
	id,
	children,
}: {
	status: StepStatus;
	id: string;
	children: ReactNode;
}) {
	return (
		<FieldTitle className={stepLabelClass(status)} id={id}>
			{children}
		</FieldTitle>
	);
}

function unitWord(unit: keyof typeof DURATION_UNIT_MS, n: number | undefined) {
	const word = UNIT_LABEL[unit].toLowerCase();
	return n === 1 ? word.slice(0, -1) : word;
}

function DurationField<Unit extends keyof typeof DURATION_UNIT_MS>({
	labelId,
	value,
	units,
	defaultUnit,
	limitMs,
	readOnly,
	onChange,
}: {
	labelId: string;
	value: { n: number; unit: Unit } | undefined;
	units: readonly Unit[];
	defaultUnit: Unit;
	limitMs: number;
	readOnly: boolean;
	onChange: (next: { n: number; unit: Unit } | undefined) => void;
}) {
	const [pendingUnit, setPendingUnit] = useState<Unit>(defaultUnit);
	const [typed, setTyped] = useState<string | null>(null);
	const unit = value?.unit ?? pendingUnit;
	const max = maxFor(unit, limitMs);
	const unitLabelId = useId();
	const set = (n: number | null) =>
		onChange(
			n === null ? undefined : { n: Math.min(Math.max(n, 1), max), unit },
		);
	return (
		<div
			className={cn(
				"field w-auto gap-1 px-2",
				readOnly && "bg-field text-text-disabled",
			)}
			data-slot="input"
		>
			<input
				aria-labelledby={labelId}
				className="w-6 min-w-0 flex-none bg-transparent text-end tabular-nums placeholder:text-text-3"
				data-control=""
				disabled={readOnly}
				inputMode="numeric"
				onBlur={() => setTyped(null)}
				onChange={(event) => {
					const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
					setTyped(digits);
					set(digits === "" ? null : Number(digits));
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
						return;
					}
					event.preventDefault();
					setTyped(null);
					set((value?.n ?? 0) + (event.key === "ArrowUp" ? 1 : -1));
				}}
				placeholder="30"
				value={typed ?? (value ? String(value.n) : "")}
			/>
			<span className="sr-only" id={unitLabelId}>
				Unit
			</span>
			<select
				aria-labelledby={unitLabelId}
				className="field-sizing-content cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed"
				data-control=""
				disabled={readOnly}
				onChange={(event) => {
					const nextUnit = units.find((entry) => entry === event.target.value);
					if (!nextUnit) {
						return;
					}
					setPendingUnit(nextUnit);
					if (value) {
						onChange({
							n: Math.min(value.n, maxFor(nextUnit, limitMs)),
							unit: nextUnit,
						});
					}
				}}
				value={unit}
			>
				{units.map((entry) => (
					<option key={entry} value={entry}>
						{unitWord(entry, value?.n)}
					</option>
				))}
			</select>
		</div>
	);
}

function CheckList<Value extends string>({
	titleId,
	row = false,
	options,
	chosen,
	readOnly,
	onToggle,
}: {
	titleId: string;
	row?: boolean;
	options: readonly { value: Value; label: string }[];
	chosen: readonly Value[];
	readOnly: boolean;
	onToggle: (value: Value, checked: boolean) => void;
}) {
	return (
		<fieldset
			aria-labelledby={titleId}
			className={cn(
				"flex min-w-0",
				row ? "flex-row flex-wrap gap-x-4 gap-y-2" : "flex-col gap-2.5",
			)}
		>
			{options.map((option) => (
				<Label className="flex items-center gap-2" key={option.value}>
					<Checkbox
						checked={chosen.includes(option.value)}
						disabled={readOnly}
						onCheckedChange={(checked) => onToggle(option.value, checked)}
					/>
					{option.label}
				</Label>
			))}
		</fieldset>
	);
}

function ScheduleSteps({
	node,
	readOnly,
	onUpdate,
	advance,
}: {
	node: Extract<WorkflowNode, { type: "trigger" }>;
	readOnly: boolean;
	onUpdate: (next: WorkflowNode) => void;
	advance: (answered: ScheduleStep, next: ScheduleDraft) => void;
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
	const matchStatus: StepStatus =
		statusOf("state") === "current" || statusOf("inactiveFor") === "current"
			? "current"
			: statusOf("state") === "answered" &&
					statusOf("inactiveFor") === "answered"
				? "answered"
				: "upcoming";
	const subjectsTitleId = useId();
	const stateTitleId = useId();
	const inactiveTitleId = useId();
	const { org } = useParams({ strict: false });
	const timezones = useTimezones(org);
	const scheduleDraft = useScheduleDraft(node.id);

	const update = (next: ScheduleDraft, answered?: ScheduleStep) => {
		onUpdate({ ...node, schedule: next });
		if (answered && missing.includes(answered)) {
			advance(answered, next);
		}
	};
	const setMatch = (
		patch: Partial<ScheduleDraft["match"]>,
		answered?: ScheduleStep,
	) => update({ ...draft, match: { ...draft.match, ...patch } }, answered);
	const subjects = draft.match.subjects ?? [];

	return (
		<>
			<Step status={statusOf("every")} step="every">
				<ScheduleTextField
					draft={scheduleDraft.draft}
					key={node.id}
					onChange={(cadence) =>
						update(
							{ ...draft, every: cadence.every, timezone: cadence.timezone },
							"every",
						)
					}
					onDraft={scheduleDraft.setDraft}
					readOnly={readOnly}
					timezones={timezones}
					value={{ every: draft.every, timezone: draft.timezone }}
				/>
			</Step>
			<Step status={statusOf("subjects")} step="subjects">
				<StepTitle id={subjectsTitleId} status={statusOf("subjects")}>
					Applies to
				</StepTitle>
				<CheckList
					chosen={subjects}
					onToggle={(subject, checked) =>
						setMatch(
							{
								subjects: SUBJECT_OPTIONS.map((o) => o.value).filter((s) =>
									s === subject ? checked : subjects.includes(s),
								),
							},
							"subjects",
						)
					}
					options={SUBJECT_OPTIONS}
					readOnly={readOnly}
					row
					titleId={subjectsTitleId}
				/>
			</Step>
			<Step status={matchStatus} step="state">
				<div className="flex items-start justify-between gap-2">
					<div className="flex flex-col gap-2">
						<StepTitle id={stateTitleId} status={statusOf("state")}>
							Status
						</StepTitle>
						<SegmentedControl
							aria-labelledby={stateTitleId}
							disabled={readOnly}
							onValueChange={(next) =>
								setMatch({ state: next as ScheduleState }, "state")
							}
							value={draft.match.state ?? ""}
						>
							{STATE_OPTIONS.map((option) => (
								<SegmentedControlItem
									className="px-1"
									key={option.value}
									value={option.value}
								>
									{option.label}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>
					<div
						className="flex shrink-0 flex-col gap-2"
						data-field="inactiveFor"
						data-step="inactiveFor"
					>
						<StepTitle id={inactiveTitleId} status={statusOf("inactiveFor")}>
							Inactive for
						</StepTitle>
						<DurationField
							defaultUnit="days"
							labelId={inactiveTitleId}
							limitMs={MAX_INACTIVE_FOR_MS}
							onChange={(inactiveFor) =>
								setMatch({ inactiveFor }, "inactiveFor")
							}
							readOnly={readOnly}
							units={INACTIVE_UNITS}
							value={draft.match.inactiveFor}
						/>
					</div>
				</div>
			</Step>
			<div className="-mx-4 mt-3 flex flex-col gap-3 border-line-faint border-t px-4 pt-4">
				<div className="flex items-center gap-1.5">
					<h3 className="type-label text-text-1">Filters</h3>
					<span className="type-caption text-text-3">Optional</span>
					<span className="ms-auto flex">
						<RefreshLabels readOnly={readOnly} />
					</span>
				</div>
				<Field data-field="labels">
					<FieldLabel className="text-text-2">With labels</FieldLabel>
					<LabelPicker
						onChange={(next) =>
							setMatch({ labels: next.length > 0 ? next : undefined })
						}
						placeholder="Any label"
						readOnly={readOnly}
						showRefresh={false}
						value={draft.match.labels ?? []}
					/>
				</Field>
				<Field data-field="excludeLabels">
					<FieldLabel className="text-text-2">Without labels</FieldLabel>
					<LabelPicker
						onChange={(next) =>
							setMatch({ excludeLabels: next.length > 0 ? next : undefined })
						}
						placeholder="No label"
						readOnly={readOnly}
						showRefresh={false}
						value={draft.match.excludeLabels ?? []}
					/>
				</Field>
				<Label className="flex items-center gap-2">
					<Checkbox
						checked={draft.match.skipLocked !== false}
						disabled={readOnly}
						onCheckedChange={(checked) => setMatch({ skipLocked: checked })}
					/>
					Skip locked
				</Label>
			</div>
		</>
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
	const runTitleId = useId();
	const whenTitleId = useId();

	const focusStep = (step: string) => {
		requestAnimationFrame(() => {
			const scope = root.current?.querySelector(`[data-step="${step}"]`);
			scope?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		});
	};
	const takePointer = () => {
		const pointer = byPointer.current;
		byPointer.current = false;
		return pointer;
	};
	const choosePath = (next: TriggerPath) => {
		const pointer = takePointer();
		if (next === path) {
			return;
		}
		onUpdate(switchTriggerPath(node, next));
		if (pointer) {
			focusStep(next === "schedule" ? "every" : "kinds");
		}
	};
	const advance = (_answered: ScheduleStep, next: ScheduleDraft) => {
		if (!takePointer()) {
			return;
		}
		const upNext = missingScheduleSteps(next)[0];
		if (upNext) {
			focusStep(upNext);
		}
	};
	const whenStatus: StepStatus = node.kinds.length > 0 ? "answered" : "current";

	return (
		<div
			className="flex flex-col gap-1"
			onKeyDownCapture={() => {
				byPointer.current = false;
			}}
			onPointerDownCapture={() => {
				byPointer.current = true;
			}}
			ref={root}
		>
			<Step status="answered" step="run">
				<StepTitle id={runTitleId} status="answered">
					Run
				</StepTitle>
				<SegmentedControl
					aria-labelledby={runTitleId}
					disabled={readOnly}
					fill
					onValueChange={(next) => choosePath(next as TriggerPath)}
					value={path}
				>
					{PATH_OPTIONS.map((option) => (
						<SegmentedControlItem
							className="px-2"
							key={option.value}
							value={option.value}
						>
							{option.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</Step>
			{path === "event" ? (
				<Step status={whenStatus} step="kinds">
					<StepTitle id={whenTitleId} status={whenStatus}>
						When
					</StepTitle>
					<CheckList
						chosen={node.kinds}
						onToggle={(kind, checked) =>
							onUpdate(toggleTriggerKind(node, kind, checked))
						}
						options={EVENT_KIND_OPTIONS.map((entry) => ({
							value: entry.kind,
							label: whenLabel(entry.kind),
						}))}
						readOnly={readOnly}
						titleId={whenTitleId}
					/>
				</Step>
			) : (
				<ScheduleSteps
					advance={advance}
					node={node}
					onUpdate={onUpdate}
					readOnly={readOnly}
				/>
			)}
		</div>
	);
}
