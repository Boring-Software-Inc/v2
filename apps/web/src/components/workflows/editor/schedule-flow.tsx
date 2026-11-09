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
import {
	LabelPicker,
	RefreshLabels,
} from "#/components/workflows/editor/label-picker";
import {
	useSavedScheduleTiming,
	useScheduleDraft,
} from "#/components/workflows/editor/node-issues";
import { ScheduleTextField } from "#/components/workflows/editor/schedule-input";
import { Checkbox } from "#/design-system/ui/checkbox";
import { Field, FieldLabel, FieldTitle, Label } from "#/design-system/ui/field";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import { useTimezones } from "#/hooks/use-timezones";
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
			data-layout-role="trigger-flow-step"
			data-field={step}
			data-status={status}
			data-step={step}
		>
			{children}
		</div>
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
		<FieldTitle
			data-layout-role="trigger-step-title"
			data-status={status}
			id={id}
		>
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
			className="field"
			data-layout-role="trigger-duration"
			data-readonly={readOnly || undefined}
			data-slot="input"
		>
			<input
				aria-labelledby={labelId}
				data-layout-role="trigger-duration-number"
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
				data-layout-role="trigger-duration-unit"
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
			data-layout-role="trigger-checklist"
			data-row={row || undefined}
		>
			{options.map((option) => (
				<Label data-layout-role="trigger-check-option" key={option.value}>
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
	const savedTiming = useSavedScheduleTiming(node.id);

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
					savedTiming={savedTiming}
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
				<div data-layout-role="trigger-match">
					<div data-layout-role="trigger-match-state">
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
									data-layout-role="trigger-state-option"
									key={option.value}
									value={option.value}
								>
									{option.label}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>
					<div
						data-layout-role="trigger-match-inactivity"
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
			<div data-layout-role="trigger-filters">
				<div data-layout-role="trigger-filters-header">
					<h3 data-layout-role="trigger-filters-title">Filters</h3>
					<span data-layout-role="trigger-refresh-labels">
						<RefreshLabels readOnly={readOnly} />
					</span>
				</div>
				<Field data-field="labels">
					<FieldLabel data-layout-role="trigger-filter-label">
						With labels
					</FieldLabel>
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
					<FieldLabel data-layout-role="trigger-filter-label">
						Without labels
					</FieldLabel>
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
				<Label data-layout-role="trigger-check-option">
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
			data-layout-role="trigger-flow"
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
							data-layout-role="trigger-path-option"
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
