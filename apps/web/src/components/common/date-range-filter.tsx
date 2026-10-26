import { useState } from "react";
import { Calendar, Check, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { FilterBarButton } from "#/components/glaze/ui/filter-bar";
import { Input } from "#/components/glaze/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { type DateRange, isoDay, lastDays, rangeLabel } from "#/lib/date-range";

const PRESETS = [
	{ days: 1, label: "Today" },
	{ days: 7, label: "Last 7 days" },
	{ days: 30, label: "Last 30 days" },
	{ days: 90, label: "Last 90 days" },
];

function presetFor(range: DateRange | null) {
	return range
		? PRESETS.find((preset) => {
				const candidate = lastDays(preset.days);
				return candidate.from === range.from && candidate.to === range.to;
			})
		: undefined;
}

export function DateRangeFilter({
	value,
	onValueChange,
}: {
	value: DateRange | null;
	onValueChange: (range: DateRange | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<DateRange>(value ?? lastDays(7));
	const preset = presetFor(value);
	const label = value ? (preset?.label ?? rangeLabel(value)) : "Any date";
	const pick = (next: DateRange | null) => {
		onValueChange(next);
		setOpen(false);
	};
	const valid = draft.from !== "" && draft.to !== "" && draft.from <= draft.to;

	return (
		<Popover
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setDraft(value ?? lastDays(7));
				}
			}}
			open={open}
		>
			<PopoverTrigger
				render={
					<FilterBarButton
						active={value !== null}
						aria-label={`Date: ${label}`}
					/>
				}
			>
				<Icon icon={Calendar} />
				{label}
			</PopoverTrigger>
			<PopoverContent align="end" className="gap-3">
				<div className="flex flex-col">
					<Button
						className="justify-start"
						onClick={() => pick(null)}
						size="sm"
						variant="ghost"
					>
						Any date
						{value ? null : <Icon className="ms-auto" icon={Check} />}
					</Button>
					{PRESETS.map((option) => (
						<Button
							className="justify-start"
							key={option.days}
							onClick={() => pick(lastDays(option.days))}
							size="sm"
							variant="ghost"
						>
							{option.label}
							{preset === option ? (
								<Icon className="ms-auto" icon={Check} />
							) : null}
						</Button>
					))}
				</div>
				<form
					className="flex flex-col gap-3 border-line-faint border-t pt-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) {
							pick(draft);
						}
					}}
				>
					<div className="grid grid-cols-2 gap-2 pointer-coarse:grid-cols-1">
						<Field>
							<FieldLabel>From</FieldLabel>
							<Input
								max={draft.to || isoDay(new Date())}
								onValueChange={(from) => setDraft((d) => ({ ...d, from }))}
								size="sm"
								type="date"
								value={draft.from}
							/>
						</Field>
						<Field>
							<FieldLabel>To</FieldLabel>
							<Input
								max={isoDay(new Date())}
								min={draft.from}
								onValueChange={(to) => setDraft((d) => ({ ...d, to }))}
								size="sm"
								type="date"
								value={draft.to}
							/>
						</Field>
					</div>
					<Button disabled={!valid} size="sm" type="submit" variant="secondary">
						Apply range
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	);
}
