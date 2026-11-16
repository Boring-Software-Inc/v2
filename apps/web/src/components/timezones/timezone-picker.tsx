import { Combobox } from "@tripwire/ui/combobox";
import { useMemo } from "react";
import { timezoneNames } from "#/lib/timezones";

interface ZoneItem {
	value: string;
	label: string;
}

const UNSET_TIMEZONE = "__tripwire_unset_timezone__";

export interface TimezonePickerProps {
	value: string | null;
	unsetLabel: string;
	disabled?: boolean;
	labelledBy?: string;
	onChange: (zone: string | null) => void;
}

export function TimezonePicker({
	value,
	unsetLabel,
	disabled,
	labelledBy,
	onChange,
}: TimezonePickerProps) {
	const options = useMemo<ZoneItem[]>(
		() => [
			{ id: UNSET_TIMEZONE, value: UNSET_TIMEZONE, label: unsetLabel },
			...timezoneNames().map((zone) => ({
				id: zone,
				value: zone,
				label: zone,
			})),
		],
		[unsetLabel],
	);

	return (
		<div data-layout-role="timezone-picker">
			<Combobox
				{...(labelledBy
					? { ariaLabelledBy: labelledBy }
					: { ariaLabel: "Timezone" })}
				disabled={disabled}
				disclosureLabel="Show timezones"
				emptyLabel="No timezone matches"
				onValueChange={(next) => {
					if (next !== null) {
						onChange(next === UNSET_TIMEZONE ? null : next);
					}
				}}
				options={options}
				value={value ?? UNSET_TIMEZONE}
			/>
		</div>
	);
}
