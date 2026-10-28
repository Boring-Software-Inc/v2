import { describe, expect, test } from "bun:test";
import {
	DEV_PRESETS,
	type DevScenario,
	getPreset,
	normalizeScenario,
	RECOVERY_INSTALLS,
} from "#/lib/dev/scenarios";
import {
	planScenario,
	resolveLanding,
	type SeededScenario,
} from "./scenario-plan.ts";

const SEEDED: SeededScenario = {
	orgSlug: "dev-owner",
	repoName: "active-webapp",
	workflowId: "wf-1",
	installState: "signed.state",
	publicRunId: "run-1",
};

const OWNER: DevScenario = {
	account: "owner",
	install: "connected",
	repos: "active",
	workflows: "live",
	landing: "home",
};

function landingFor(scenario: DevScenario, seeded = SEEDED): string {
	const normalized = normalizeScenario(scenario);
	return resolveLanding(normalized, planScenario(normalized), seeded);
}

function presetScenario(id: string): DevScenario {
	const preset = getPreset(id);
	if (!preset) {
		throw new Error(`no preset ${id}`);
	}
	return preset.scenario;
}

describe("planScenario", () => {
	test("an owner seeds repos into their personal org", () => {
		const plan = planScenario(OWNER);
		expect(plan.user?.email).toBe("owner@tripwire.demo");
		expect(plan.orgKind).toBe("personal");
		expect(plan.repos).toMatchObject({
			kind: "active",
			installationId: "demo-inst-active",
			names: ["active-webapp"],
		});
		expect(plan.publicRun).toBe(false);
	});

	test("a member joins the team org as a plain member", () => {
		const plan = planScenario(presetScenario("member"));
		expect(plan.orgKind).toBe("team");
		expect(plan.teamRole).toBe("member");
		expect(plan.repos?.names).toEqual(["solo-webapp"]);
	});

	test("an outsider sees the team org without joining it", () => {
		const plan = planScenario(presetScenario("outsider"));
		expect(plan.orgKind).toBe("team");
		expect(plan.teamRole).toBeNull();
		expect(plan.workflows).toBe("none");
	});

	test("anonymous has no user and seeds a public run", () => {
		const plan = planScenario(presetScenario("anonymous"));
		expect(plan.user).toBeNull();
		expect(plan.repos).toBeNull();
		expect(plan.publicRun).toBe(true);
	});

	test("installs map to unclaimed installs and requests", () => {
		const waiting = planScenario(presetScenario("install-confirmation"));
		expect(waiting.unclaimed?.repoNames.length).toBeGreaterThan(0);
		const syncing = planScenario(presetScenario("install-syncing"));
		expect(syncing.unclaimed?.repoNames).toEqual([]);
		expect(
			planScenario(presetScenario("install-request-approved")).approvedRequest,
		).toBe(true);
		const fresh = planScenario(presetScenario("fresh"));
		expect(fresh.unclaimed).toBeNull();
		expect(fresh.repos).toBeNull();
	});
});

describe("resolveLanding", () => {
	test("org and repo landings are concrete routes", () => {
		expect(landingFor(OWNER)).toBe("/dev-owner/home");
		expect(landingFor({ ...OWNER, landing: "repo" })).toBe(
			"/dev-owner/active-webapp",
		);
		expect(landingFor({ ...OWNER, landing: "workflows" })).toBe(
			"/dev-owner/active-webapp/workflows",
		);
		expect(landingFor({ ...OWNER, landing: "workflow" })).toBe(
			"/dev-owner/active-webapp/workflows/wf-1",
		);
		expect(landingFor({ ...OWNER, landing: "settings" })).toBe(
			"/dev-owner/settings/general",
		);
		expect(landingFor({ ...OWNER, landing: "public-run" })).toBe("/runs/run-1");
	});

	test("the workflow editor falls back to the list without a workflow", () => {
		expect(
			landingFor(
				{ ...OWNER, landing: "workflow" },
				{ ...SEEDED, workflowId: null },
			),
		).toBe("/dev-owner/active-webapp/workflows");
	});

	test("install setup carries the installation and the signed state", () => {
		const url = new URL(
			landingFor(presetScenario("install-confirmation")),
			"http://localhost",
		);
		expect(url.pathname).toBe("/onboarding/setup");
		expect(url.searchParams.get("installation_id")).toBe("demo-inst-confirm");
		expect(url.searchParams.get("state")).toBe("signed.state");
		expect(landingFor(presetScenario("install-syncing"))).toContain(
			"installation_id=demo-inst-syncing",
		);
		expect(landingFor(presetScenario("install-request-pending"))).toBe(
			"/onboarding/setup?setup_action=request",
		);
		expect(
			landingFor({
				...presetScenario("install-request-approved"),
				landing: "install-setup",
			}),
		).toBe("/onboarding/setup?installation_id=demo-inst-pending");
	});

	test("each recovery state plans its own installation and lands on setup", () => {
		const seen = new Set<string>();
		for (const install of RECOVERY_INSTALLS) {
			const plan = planScenario(presetScenario(install));
			expect(plan.recovery).not.toBeNull();
			expect(plan.unclaimed).toBeNull();
			expect(plan.repos).toBeNull();
			const installationId = plan.recovery?.installationId ?? "";
			seen.add(installationId);
			const url = new URL(
				landingFor(presetScenario(install)),
				"http://localhost",
			);
			expect(url.pathname).toBe("/onboarding/setup");
			expect(url.searchParams.get("installation_id")).toBe(installationId);
			expect(url.searchParams.get("state")).toBe("signed.state");
		}
		expect(seen.size).toBe(RECOVERY_INSTALLS.length);
		expect(planScenario(presetScenario("install-missing")).recovery).toEqual({
			installationId: "demo-inst-missing",
			state: "missing",
		});
	});

	test("anonymous lands on the public run", () => {
		expect(
			landingFor(presetScenario("anonymous"), { ...SEEDED, orgSlug: null }),
		).toBe("/runs/run-1");
	});

	test("every preset resolves to an absolute path", () => {
		for (const preset of DEV_PRESETS) {
			expect(landingFor(preset.scenario)).toMatch(/^\/[^/]/);
		}
	});
});
