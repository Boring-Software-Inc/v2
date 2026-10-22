import { type Ref, useMemo, useState } from "react";
import { Check, Icon, Pending } from "#/components/glaze/icon";
import {
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandLabel,
	CommandList,
} from "#/components/glaze/ui/command";
import { groupPresets } from "#/lib/dev/scenario-panel";
import {
	DEV_LATENCY_LABELS,
	type DevPreset,
	searchPresets,
} from "#/lib/dev/scenarios";

interface DevPresetListProps {
	busy: string | null;
	currentId: string | null;
	onApply: (preset: DevPreset) => void;
	searchRef?: Ref<HTMLInputElement>;
}

export function DevPresetList({
	busy,
	currentId,
	onApply,
	searchRef,
}: DevPresetListProps) {
	const [query, setQuery] = useState("");
	const groups = useMemo(() => groupPresets(searchPresets(query)), [query]);
	return (
		<>
			<CommandInput
				autoFocus
				onValueChange={setQuery}
				placeholder="Search presets"
				ref={searchRef}
				value={query}
			/>
			<CommandList>
				<CommandEmpty />
				{groups.map((entry) => (
					<CommandGroup heading={entry.group} key={entry.group}>
						{entry.presets.map((preset) => (
							<CommandItem
								disabled={busy !== null && busy !== preset.id}
								key={preset.id}
								onSelect={() => onApply(preset)}
								value={preset.id}
							>
								<CommandLabel className="flex-1">{preset.label}</CommandLabel>
								{preset.latency > 0 ? (
									<span className="type-caption text-text-3">
										{DEV_LATENCY_LABELS[preset.latency]}
									</span>
								) : null}
								{busy === preset.id ? (
									<Icon
										className="animate-spin motion-reduce:animate-none"
										icon={Pending}
										label="Applying"
									/>
								) : preset.id === currentId ? (
									<Icon icon={Check} label="Current" />
								) : null}
							</CommandItem>
						))}
					</CommandGroup>
				))}
			</CommandList>
		</>
	);
}
