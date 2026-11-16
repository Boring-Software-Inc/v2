import { Button } from "@tripwire/ui/button";
import { Field, FieldLabel, Input } from "@tripwire/ui/field";
import { Calendar, Check, Icon } from "@tripwire/ui/icon";
import { Popover } from "@tripwire/ui/popover";
import { useState } from "react";
import { FilterBarButton } from "#/components/common/filter-bar";
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
			align="end"
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setDraft(value ?? lastDays(7));
				}
			}}
			open={open}
			trigger={
				<FilterBarButton active={value !== null} aria-label={`Date: ${label}`}>
					<Icon icon={Calendar} size={12} />
					{label}
				</FilterBarButton>
			}
			triggerLabel={`Date: ${label}`}
		>
			<div className="flex flex-col composition-gap-section">
				<div className="flex flex-col">
					<div className="flex justify-start">
						<Button onAction={() => pick(null)} size="small" variant="ghost">
							Any date
							{value ? null : (
								<span className="composition-push-end">
									<Icon icon={Check} />
								</span>
							)}
						</Button>
					</div>
					{PRESETS.map((option) => (
						<div className="flex justify-start" key={option.days}>
							<Button
								onAction={() => pick(lastDays(option.days))}
								size="small"
								variant="ghost"
							>
								{option.label}
								{preset === option ? (
									<span className="composition-push-end">
										<Icon icon={Check} />
									</span>
								) : null}
							</Button>
						</div>
					))}
				</div>
				<form
					className="flex flex-col composition-gap-section tone-border-faint border-t"
					data-layout-role="date-range-form"
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) {
							pick(draft);
						}
					}}
				>
					<div className="grid grid-cols-2 composition-gap-standard pointer-coarse:grid-cols-1">
						<Field>
							<FieldLabel>From</FieldLabel>
							<Input
								labelledByField
								max={draft.to || isoDay(new Date())}
								onValueChange={(from) => setDraft((d) => ({ ...d, from }))}
								type="date"
								value={draft.from}
							/>
						</Field>
						<Field>
							<FieldLabel>To</FieldLabel>
							<Input
								labelledByField
								max={isoDay(new Date())}
								min={draft.from}
								onValueChange={(to) => setDraft((d) => ({ ...d, to }))}
								type="date"
								value={draft.to}
							/>
						</Field>
					</div>
					<Button
						disabled={!valid}
						size="small"
						type="submit"
						variant="secondary"
					>
						Apply range
					</Button>
				</form>
			</div>
		</Popover>
	);
}
