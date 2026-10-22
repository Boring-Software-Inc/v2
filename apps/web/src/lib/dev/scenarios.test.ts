import { describe, expect, test } from "bun:test";
import {
	blockedReason,
	DEFAULT_PRESET_ID,
	DEV_AXES,
	DEV_LATENCY_MAX_MS,
	DEV_OPTIONS,
	DEV_PRESETS,
	type DevScenario,
	devLatencyMs,
	getPreset,
	normalizeScenario,
	searchPresets,
	transitionScenario,
} from "./scenarios.ts";

const OWNER: DevScenario = {
	account: "owner",
	install: "connected",
	repos: "active",
	workflows: "live",
	landing: "workflows",
};

function isValid(state: DevScenario): boolean {
	return DEV_AXES.every(
		(axis) => blockedReason(state, axis, state[axis]) === null,
	);
}

function everyScenario(): DevScenario[] {
	const all: DevScenario[] = [];
	for (const account of DEV_OPTIONS.account) {
		for (const install of DEV_OPTIONS.install) {
			for (const repos of DEV_OPTIONS.repos) {
				for (const workflows of DEV_OPTIONS.workflows) {
					for (const landing of DEV_OPTIONS.landing) {
						all.push({ account, install, repos, workflows, landing });
					}
				}
			}
		}
	}
	return all;
}

describe("dev scenario state machine", () => {
	test("normalizing any combination yields a valid scenario", () => {
		for (const state of everyScenario()) {
			expect(isValid(normalizeScenario(state))).toBe(true);
		}
	});

	test("a valid scenario is left alone", () => {
		expect(normalizeScenario(OWNER)).toEqual(OWNER);
	});

	test("signing out clears org state and lands on a public run", () => {
		expect(transitionScenario(OWNER, "account", "anonymous")).toEqual({
			account: "anonymous",
			install: "none",
			repos: "none",
			workflows: "none",
			landing: "public-run",
		});
	});

	test("dropping the install drops repos, workflows and repo landings", () => {
		const next = transitionScenario(OWNER, "install", "none");
		expect(next.repos).toBe("none");
		expect(next.workflows).toBe("none");
		expect(next.landing).toBe("home");
	});

	test("members always view a connected team org", () => {
		const fresh = transitionScenario(OWNER, "install", "none");
		expect(transitionScenario(fresh, "account", "member").install).toBe(
			"connected",
		);
		expect(blockedReason(OWNER, "install", "none")).toBeNull();
		expect(
			blockedReason({ ...OWNER, account: "member" }, "install", "none"),
		).not.toBeNull();
	});

	test("outsiders cannot reach workflows or settings", () => {
		const outsider = transitionScenario(OWNER, "account", "outsider");
		expect(outsider.workflows).toBe("none");
		expect(outsider.landing).not.toBe("workflows");
		expect(blockedReason(outsider, "landing", "settings")).not.toBeNull();
	});

	test("the install setup screen needs a request or an unconnected install", () => {
		expect(blockedReason(OWNER, "landing", "install-setup")).not.toBeNull();
		for (const install of [
			"request-pending",
			"request-approved",
			"awaiting-confirmation",
			"syncing",
		] as const) {
			const next = transitionScenario(OWNER, "install", install);
			expect(blockedReason(next, "landing", "install-setup")).toBeNull();
		}
		const fresh = transitionScenario(OWNER, "install", "none");
		expect(blockedReason(fresh, "landing", "install-setup")).not.toBeNull();
	});
});

describe("dev presets", () => {
	test("every preset is a valid scenario with a unique id", () => {
		const ids = new Set(DEV_PRESETS.map((preset) => preset.id));
		expect(ids.size).toBe(DEV_PRESETS.length);
		for (const preset of DEV_PRESETS) {
			expect(isValid(preset.scenario)).toBe(true);
		}
	});

	test("the old persona ids still resolve", () => {
		for (const id of [
			"fresh",
			"one-repo",
			"many-repos",
			"empty",
			"active",
			"anonymous",
		]) {
			expect(getPreset(id)).toBeDefined();
		}
		expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
	});

	test("search matches label, group and keywords across terms", () => {
		expect(searchPresets("")).toHaveLength(DEV_PRESETS.length);
		expect(searchPresets("install confirm").map((p) => p.id)).toEqual([
			"install-confirmation",
		]);
		expect(searchPresets("spinner").map((p) => p.id)).toEqual([
			"forge-loading",
			"home-loading",
		]);
		expect(searchPresets("nothing matches this")).toEqual([]);
	});
});

describe("dev latency cookie", () => {
	test("absent, zero or junk means no delay", () => {
		expect(devLatencyMs(undefined)).toBe(0);
		expect(devLatencyMs("")).toBe(0);
		expect(devLatencyMs("0")).toBe(0);
		expect(devLatencyMs("-50")).toBe(0);
		expect(devLatencyMs("slow")).toBe(0);
	});

	test("a delay is read in milliseconds and clamped", () => {
		expect(devLatencyMs("1500")).toBe(1500);
		expect(devLatencyMs("999999")).toBe(DEV_LATENCY_MAX_MS);
	});
});
