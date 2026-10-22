import { z } from "zod";
import {
	DEFAULT_PRESET_ID,
	DEV_LATENCIES,
	DEV_PRESETS,
	type DevLatency,
	type DevPreset,
	type DevScenario,
	devScenarioSchema,
	getPreset,
	normalizeScenario,
	sameScenario,
} from "#/lib/dev/scenarios";

export const DEV_PANEL_STORAGE_KEY = "tw-dev-scenario";
export const DEV_APPLIED_STORAGE_KEY = "tw-dev-applied";

export interface DevPanelState {
	scenario: DevScenario;
	latency: DevLatency;
}

export interface DevAppliedState extends DevPanelState {
	presetId: string | null;
}

export interface DevPresetGroup {
	group: string;
	presets: DevPreset[];
}

const panelStateSchema = z.object({
	scenario: devScenarioSchema,
	latency: z.literal(DEV_LATENCIES),
});

const appliedStateSchema = panelStateSchema.extend({
	presetId: z.string().nullable(),
});

export function groupPresets(presets: readonly DevPreset[]): DevPresetGroup[] {
	const groups: DevPresetGroup[] = [];
	for (const preset of presets) {
		const existing = groups.find((entry) => entry.group === preset.group);
		if (existing) {
			existing.presets.push(preset);
		} else {
			groups.push({ group: preset.group, presets: [preset] });
		}
	}
	return groups;
}

export function findMatchingPreset(
	state: DevPanelState,
): DevPreset | undefined {
	const matches = DEV_PRESETS.filter((preset) =>
		sameScenario(preset.scenario, state.scenario),
	);
	return (
		matches.find((preset) => preset.latency === state.latency) ?? matches[0]
	);
}

export function defaultPanelState(): DevPanelState {
	const preset = getPreset(DEFAULT_PRESET_ID) ?? DEV_PRESETS[0];
	return { scenario: preset.scenario, latency: preset.latency };
}

function parseJson(raw: string | null): object | null {
	if (raw === null) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function parsePanelState(raw: string | null): DevPanelState {
	const parsed = panelStateSchema.safeParse(parseJson(raw));
	if (!parsed.success) {
		return defaultPanelState();
	}
	return {
		scenario: normalizeScenario(parsed.data.scenario),
		latency: parsed.data.latency,
	};
}

export function parseAppliedState(raw: string | null): DevAppliedState | null {
	const parsed = appliedStateSchema.safeParse(parseJson(raw));
	return parsed.success ? parsed.data : null;
}
