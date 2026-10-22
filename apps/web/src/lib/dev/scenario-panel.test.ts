import { describe, expect, test } from "bun:test";
import {
	type DevAppliedState,
	defaultPanelState,
	findMatchingPreset,
	groupPresets,
	parseAppliedState,
	parsePanelState,
} from "./scenario-panel.ts";
import { DEV_PRESETS, type DevScenario, getPreset } from "./scenarios.ts";

const OWNER: DevScenario = {
	account: "owner",
	install: "connected",
	repos: "active",
	workflows: "off",
	landing: "home",
};

describe("groupPresets", () => {
	test("keeps first-seen group order and preset order", () => {
		const groups = groupPresets(DEV_PRESETS);
		expect(groups.map((entry) => entry.group)).toEqual([
			"Accounts",
			"Onboarding",
			"Install recovery",
			"Loading",
			"Workflows",
			"Settings",
		]);
		expect(groups.flatMap((entry) => entry.presets)).toEqual([...DEV_PRESETS]);
	});

	test("returns no groups for no presets", () => {
		expect(groupPresets([])).toEqual([]);
	});
});

describe("findMatchingPreset", () => {
	test("prefers the preset with the same latency", () => {
		const loading = getPreset("forge-loading");
		const fresh = getPreset("fresh");
		expect(loading && fresh).toBeTruthy();
		if (!loading || !fresh) {
			return;
		}
		expect(
			findMatchingPreset({ scenario: fresh.scenario, latency: 1500 })?.id,
		).toBe("forge-loading");
		expect(
			findMatchingPreset({ scenario: fresh.scenario, latency: 0 })?.id,
		).toBe("fresh");
	});

	test("falls back to a scenario match at any latency", () => {
		expect(findMatchingPreset({ scenario: OWNER, latency: 4000 })?.id).toBe(
			"active",
		);
	});

	test("returns nothing for a custom scenario", () => {
		expect(
			findMatchingPreset({
				scenario: { ...OWNER, repos: "many", landing: "settings" },
				latency: 0,
			}),
		).toBeUndefined();
	});
});

describe("parsePanelState", () => {
	test("falls back to the default preset", () => {
		expect(parsePanelState(null)).toEqual(defaultPanelState());
		expect(parsePanelState("not json")).toEqual(defaultPanelState());
		expect(parsePanelState('{"scenario":{},"latency":0}')).toEqual(
			defaultPanelState(),
		);
	});

	test("rejects unknown latencies", () => {
		expect(
			parsePanelState(JSON.stringify({ scenario: OWNER, latency: 7 })),
		).toEqual(defaultPanelState());
	});

	test("normalizes a stored scenario that breaks a guard", () => {
		const state = parsePanelState(
			JSON.stringify({
				scenario: { ...OWNER, account: "anonymous" },
				latency: 400,
			}),
		);
		expect(state.latency).toBe(400);
		expect(state.scenario.install).toBe("none");
		expect(state.scenario.landing).toBe("public-run");
	});
});

describe("parseAppliedState", () => {
	test("reads a stored record", () => {
		const applied: DevAppliedState = {
			scenario: OWNER,
			latency: 0,
			presetId: "active",
		};
		expect(parseAppliedState(JSON.stringify(applied))).toEqual(applied);
	});

	test("returns null for junk", () => {
		expect(parseAppliedState(null)).toBeNull();
		expect(parseAppliedState("{}")).toBeNull();
	});
});
