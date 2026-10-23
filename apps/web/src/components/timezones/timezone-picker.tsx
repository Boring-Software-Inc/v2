import { useMemo } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "#/components/glaze/ui/combobox";
import { timezoneNames } from "#/lib/timezones";

interface ZoneItem {
	value: string | null;
	label: string;
}

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
	const items = useMemo<ZoneItem[]>(
		() => [
			{ value: null, label: unsetLabel },
			...timezoneNames().map((zone) => ({ value: zone, label: zone })),
		],
		[unsetLabel],
	);
	const chosen =
		items.find((item) => item.value === value) ??
		(value ? { value, label: value } : items[0]);
	return (
		<Combobox<ZoneItem>
			disabled={disabled}
			isItemEqualToValue={(item, other) => item.value === other.value}
			itemToStringLabel={(item) => item.label}
			items={items}
			onValueChange={(next) => {
				if (next) {
					onChange(next.value);
				}
			}}
			value={chosen}
		>
			<ComboboxInput aria-labelledby={labelledBy} disabled={disabled} />
			<ComboboxContent>
				<ComboboxEmpty>No timezone matches</ComboboxEmpty>
				<ComboboxList>
					{(item: ZoneItem) => (
						<ComboboxItem key={item.value ?? "unset"} value={item}>
							{item.label}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
