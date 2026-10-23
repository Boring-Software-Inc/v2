import type {
	EveryUnit,
	ScheduleCadence,
	SchedulePreset,
	TimeOfDay,
	Weekday,
} from "@tripwire/contracts";
import {
	DURATION_UNIT_MS,
	describeSchedule,
	formatScheduleTime,
	MAX_SCHEDULE_EVERY_MS,
	nextScheduleRun,
	scheduleCronSchema,
	scheduleZone,
	timeOfDaySchema,
	weekdaySchema,
} from "@tripwire/contracts";
import { useId, useState } from "react";
import { Field, FieldError, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { NumberInput } from "#/components/glaze/ui/number-input";
import { Select } from "#/components/glaze/ui/select";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import type { Timezones } from "#/hooks/use-timezones";
import {
	CADENCE_KIND_OPTIONS,
	type CadenceKind,
	cadenceForKind,
	cadenceKind,
	isClockCadence,
} from "#/lib/schedule-cadence";
import { UNIT_LABEL } from "#/lib/schedule-summary";

const EVERY_UNITS: readonly EveryUnit[] = ["hours", "days", "weeks"];

const WEEKDAY_OPTIONS = weekdaySchema.options.map((day) => ({
	value: day,
	label: `${day.charAt(0).toUpperCase()}${day.slice(1)}`,
}));

export interface CadenceValue {
	every: ScheduleCadence | undefined;
	timezone: string | undefined;
}

function sentence(message: string): string {
	return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;
}

function TimeField({
	label,
	value,
	readOnly,
	onChange,
}: {
	label: string;
	value: TimeOfDay;
	readOnly: boolean;
	onChange: (at: TimeOfDay) => void;
}) {
	return (
		<Field className="min-w-0 flex-1">
			<FieldLabel className="text-text-2">{label}</FieldLabel>
			<Input
				disabled={readOnly}
				onChange={(event) => {
					const parsed = timeOfDaySchema.safeParse(event.target.value);
					if (parsed.success) {
						onChange(parsed.data);
					}
				}}
				type="time"
				value={value}
			/>
		</Field>
	);
}

function PresetFields({
	preset,
	readOnly,
	onChange,
}: {
	preset: SchedulePreset;
	readOnly: boolean;
	onChange: (next: SchedulePreset) => void;
}) {
	const weekdayLabelId = useId();
	if (preset.preset === "hourly") {
		return (
			<Field>
				<FieldLabel className="text-text-2">At minute</FieldLabel>
				<NumberInput
					className="w-28"
					disabled={readOnly}
					max={59}
					min={0}
					onValueChange={(minute) =>
						onChange({ ...preset, minute: minute ?? 0 })
					}
					value={preset.minute}
				/>
			</Field>
		);
	}
	const at = (
		<TimeField
			label="At"
			onChange={(next) => onChange({ ...preset, at: next })}
			readOnly={readOnly}
			value={preset.at}
		/>
	);
	if (preset.preset === "weekly") {
		return (
			<div className="flex items-end gap-2">
				<Field className="min-w-0 flex-1">
					<FieldLabel className="text-text-2" id={weekdayLabelId}>
						On
					</FieldLabel>
					<Select
						aria-labelledby={weekdayLabelId}
						disabled={readOnly}
						items={WEEKDAY_OPTIONS}
						native
						onValueChange={(next) => {
							const day = weekdaySchema.safeParse(next);
							if (day.success) {
								onChange({ ...preset, on: day.data satisfies Weekday });
							}
						}}
						value={preset.on}
					/>
				</Field>
				{at}
			</div>
		);
	}
	if (preset.preset === "monthly") {
		return (
			<div className="flex items-end gap-2">
				<Field className="w-28 shrink-0">
					<FieldLabel className="text-text-2">On day</FieldLabel>
					<NumberInput
						disabled={readOnly}
						max={28}
						min={1}
						onValueChange={(day) => onChange({ ...preset, day: day ?? 1 })}
						value={preset.day}
					/>
				</Field>
				{at}
			</div>
		);
	}
	return at;
}

function IntervalFields({
	interval,
	readOnly,
	onChange,
}: {
	interval: { n: number; unit: EveryUnit };
	readOnly: boolean;
	onChange: (next: { n: number; unit: EveryUnit }) => void;
}) {
	const unitLabelId = useId();
	const maxFor = (unit: EveryUnit) =>
		Math.floor(MAX_SCHEDULE_EVERY_MS / DURATION_UNIT_MS[unit]);
	return (
		<Field>
			<FieldLabel className="text-text-2">Every</FieldLabel>
			<div className="flex items-center gap-2">
				<NumberInput
					className="w-28 shrink-0"
					disabled={readOnly}
					max={maxFor(interval.unit)}
					min={1}
					onValueChange={(n) => onChange({ ...interval, n: n ?? 1 })}
					value={interval.n}
				/>
				<span className="sr-only" id={unitLabelId}>
					Unit
				</span>
				<Select
					aria-labelledby={unitLabelId}
					className="min-w-0 flex-1"
					disabled={readOnly}
					items={EVERY_UNITS.map((unit) => ({
						value: unit,
						label: UNIT_LABEL[unit],
					}))}
					native
					onValueChange={(next) => {
						const unit = EVERY_UNITS.find((entry) => entry === next);
						if (unit) {
							onChange({ n: Math.min(interval.n, maxFor(unit)), unit });
						}
					}}
					value={interval.unit}
				/>
			</div>
		</Field>
	);
}

function CronField({
	cron,
	readOnly,
	onChange,
}: {
	cron: string;
	readOnly: boolean;
	onChange: (cron: string) => void;
}) {
	const [text, setText] = useState(cron);
	const parsed = scheduleCronSchema.safeParse({ cron: text });
	const error = parsed.success
		? null
		: sentence(parsed.error.issues[0]?.message ?? "this cron does not parse");
	return (
		<Field data-field="cron" invalid={error !== null}>
			<FieldLabel className="text-text-2">Cron</FieldLabel>
			<Input
				autoComplete="off"
				disabled={readOnly}
				mono
				onChange={(event) => {
					const next = event.target.value;
					setText(next);
					const valid = scheduleCronSchema.safeParse({ cron: next });
					if (valid.success) {
						onChange(valid.data.cron);
					}
				}}
				placeholder="0 7 1 * *"
				spellCheck={false}
				value={text}
			/>
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}

function ReadBack({
	every,
	timezone,
	display,
}: {
	every: ScheduleCadence;
	timezone: string | undefined;
	display: string;
}) {
	const zone = scheduleZone(timezone);
	const next = nextScheduleRun(
		{ every, timezone },
		{ after: new Date(), lastTickAt: null },
	);
	const clock = isClockCadence(every);
	return (
		<output
			aria-live="polite"
			className="flex flex-col gap-0.5 rounded-tag bg-field px-3 py-2"
			data-field="read-back"
		>
			<span className="type-body-sm text-text-1">
				{describeSchedule({ every, timezone })}
			</span>
			{clock && next ? (
				<span className="type-caption text-text-2">
					Next run {formatScheduleTime(next, zone.zone)}
				</span>
			) : null}
			{clock && next && display !== zone.zone ? (
				<span className="type-caption text-text-2">
					Your time {formatScheduleTime(next, display)}
				</span>
			) : null}
		</output>
	);
}

export function ScheduleCadenceField({
	value,
	readOnly,
	timezones,
	onChange,
}: {
	value: CadenceValue;
	readOnly: boolean;
	timezones: Timezones;
	onChange: (next: CadenceValue) => void;
}) {
	const kindLabelId = useId();
	const zoneLabelId = useId();
	const every = value.every;
	const kind = every ? cadenceKind(every) : undefined;
	const setEvery = (next: ScheduleCadence) =>
		onChange({
			every: next,
			timezone:
				isClockCadence(next) && value.timezone === undefined
					? timezones.newSchedule
					: value.timezone,
		});
	return (
		<div className="flex flex-col gap-3">
			<Field>
				<FieldLabel id={kindLabelId}>Runs</FieldLabel>
				<Select
					aria-labelledby={kindLabelId}
					disabled={readOnly}
					items={
						kind
							? CADENCE_KIND_OPTIONS
							: [
									{ value: "", label: "Choose how often" },
									...CADENCE_KIND_OPTIONS,
								]
					}
					native
					onValueChange={(next) => {
						const picked = CADENCE_KIND_OPTIONS.find(
							(option) => option.value === next,
						);
						if (picked) {
							setEvery(
								cadenceForKind(picked.value satisfies CadenceKind, every),
							);
						}
					}}
					value={kind ?? ""}
				/>
			</Field>
			{every && "n" in every ? (
				<IntervalFields
					interval={every}
					onChange={setEvery}
					readOnly={readOnly}
				/>
			) : null}
			{every && "preset" in every ? (
				<PresetFields onChange={setEvery} preset={every} readOnly={readOnly} />
			) : null}
			{every && "cron" in every ? (
				<CronField
					cron={every.cron}
					onChange={(cron) => setEvery({ cron })}
					readOnly={readOnly}
				/>
			) : null}
			{isClockCadence(every) ? (
				<Field>
					<FieldLabel className="text-text-2" id={zoneLabelId}>
						Timezone
					</FieldLabel>
					<TimezonePicker
						disabled={readOnly}
						labelledBy={zoneLabelId}
						onChange={(zone) =>
							onChange({ every, timezone: zone ?? undefined })
						}
						unsetLabel="UTC, the default"
						value={value.timezone ?? null}
					/>
				</Field>
			) : null}
			{every ? (
				<ReadBack
					display={timezones.display.zone}
					every={every}
					timezone={value.timezone}
				/>
			) : null}
		</div>
	);
}
