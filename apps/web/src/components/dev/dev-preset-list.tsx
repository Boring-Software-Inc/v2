import { type Ref, useMemo, useState } from "react";
import { Icon, Pending } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/glaze/ui/command";
import { groupPresets, summarizeScenario } from "#/lib/dev/scenario-panel";
import {
	DEV_LATENCY_LABELS,
	type DevPreset,
	searchPresets,
} from "#/lib/dev/scenarios";

interface DevPresetListProps {
	busy: string | null;
	currentId: string | null;
	matchId: string | null;
	onApply: (preset: DevPreset) => void;
	searchRef?: Ref<HTMLInputElement>;
}

export function DevPresetList({
	busy,
	currentId,
	matchId,
	onApply,
	searchRef,
}: DevPresetListProps) {
	const [query, setQuery] = useState("");
	const groups = useMemo(() => groupPresets(searchPresets(query)), [query]);
	return (
		<Command className="min-w-0 flex-1" label="Presets" shouldFilter={false}>
			<CommandInput
				onValueChange={setQuery}
				placeholder="Search presets"
				ref={searchRef}
				value={query}
			/>
			<CommandList className="max-h-112">
				<CommandEmpty />
				{groups.map((entry) => (
					<CommandGroup heading={entry.group} key={entry.group}>
						{entry.presets.map((preset) => (
							<CommandItem
								className="py-1.5"
								disabled={busy !== null && busy !== preset.id}
								key={preset.id}
								onSelect={() => onApply(preset)}
								value={preset.id}
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate">{preset.label}</span>
									<span className="truncate type-caption text-text-2">
										{summarizeScenario(preset.scenario)}
									</span>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									{preset.latency > 0 ? (
										<Badge size="sm" variant="outline">
											{DEV_LATENCY_LABELS[preset.latency]}
										</Badge>
									) : null}
									{preset.id === matchId ? (
										<Badge size="sm" variant="outline">
											Custom
										</Badge>
									) : null}
									{preset.id === currentId ? (
										<Badge size="sm">Current</Badge>
									) : null}
									{busy === preset.id ? (
										<Icon
											className="animate-spin motion-reduce:animate-none"
											icon={Pending}
											label="Applying"
										/>
									) : (
										<span className="hidden type-caption text-text-3 group-data-highlighted/command-item:inline">
											Apply
										</span>
									)}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				))}
			</CommandList>
		</Command>
	);
}
