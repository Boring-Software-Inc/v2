import { Command, type CommandEntry } from "@tripwire/ui/command";
import { Check, Icon, Pending } from "@tripwire/ui/icon";
import { type ReactNode, type Ref, useMemo, useState } from "react";
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
	trailingContent?: ReactNode;
}

export function DevPresetList({
	busy,
	currentId,
	onApply,
	searchRef,
	trailingContent,
}: DevPresetListProps) {
	const [query, setQuery] = useState("");
	const groups = useMemo(() => groupPresets(searchPresets(query)), [query]);
	const items: CommandEntry[] = groups.map((entry) => ({
		items: entry.presets.map((preset) => ({
			badge:
				preset.id === currentId
					? "Current"
					: preset.latency > 0
						? DEV_LATENCY_LABELS[preset.latency]
						: undefined,
			disabled: busy !== null && busy !== preset.id,
			icon:
				busy === preset.id ? (
					<Icon icon={Pending} label="Applying" motion="spin" />
				) : preset.id === currentId ? (
					<Icon icon={Check} label="Current" />
				) : undefined,
			label: preset.label,
			onAction: () => onApply(preset),
			value: preset.id,
		})),
		label: entry.group,
		type: "group" as const,
	}));
	if (trailingContent) {
		items.push({
			content: trailingContent,
			id: "dev-scenario-controls",
			type: "content",
		});
	}
	return (
		<Command
			ariaLabel="Dev scenarios"
			autoFocus
			inputRef={searchRef}
			items={items}
			onQueryChange={setQuery}
			placeholder="Search presets"
		/>
	);
}
