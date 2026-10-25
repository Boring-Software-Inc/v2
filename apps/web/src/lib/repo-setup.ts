import {
	ruleSetNames,
	type SetupStage,
	type SetupStageState,
	type SetupStages,
} from "@tripwire/contracts";
import type { RepoAgentRun, RepoSetupFacts } from "@tripwire/db";

export type SetupStepKey = "install" | "rules" | "check" | "responses";

export const SETUP_STEP_KEYS: readonly SetupStepKey[] = [
	"install",
	"rules",
	"check",
	"responses",
];

export interface SetupStep {
	key: SetupStepKey;
	done: boolean;
	title: string;
	detail: string | null;
}

export interface RepoSetupProgress {
	steps: SetupStep[];
	done: number;
	total: number;
	current: SetupStep | null;
	complete: boolean;
}

const TODO_TITLES: Record<SetupStepKey, string> = {
	install: "Install the GitHub App",
	rules: "Turn on rules",
	check: "See a first check",
	responses: "Pick what Tripwire posts",
};

export function rulesOn(facts: RepoSetupFacts): boolean {
	return (
		facts.armed &&
		facts.enabledRuleIds.length + facts.customRulesOn + facts.workflowsOn > 0
	);
}

export function rulesSummary(facts: RepoSetupFacts): string {
	const names = ruleSetNames(facts.enabledRuleIds);
	if (facts.customRulesOn > 0) {
		names.push(
			facts.customRulesOn === 1
				? "1 custom rule"
				: `${facts.customRulesOn} custom rules`,
		);
	}
	if (facts.workflowsOn > 0) {
		names.push(
			facts.workflowsOn === 1 ? "1 workflow" : `${facts.workflowsOn} workflows`,
		);
	}
	if (names.length <= 2) {
		return names.join(" and ");
	}
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function step(
	key: SetupStepKey,
	done: boolean,
	doneTitle: string,
	detail: string | null,
): SetupStep {
	return {
		key,
		done,
		title: done ? doneTitle : TODO_TITLES[key],
		detail: done ? detail : null,
	};
}

export function setupProgress(facts: RepoSetupFacts): RepoSetupProgress {
	const steps = [
		step("install", facts.installed, "GitHub App installed", null),
		step("rules", rulesOn(facts), "Rules on", rulesSummary(facts) || null),
		step(
			"check",
			facts.firstCheck !== null,
			facts.firstCheck ? `First check on #${facts.firstCheck.number}` : "",
			null,
		),
		step("responses", facts.responsesChosen, "Responses set", null),
	];
	const done = steps.filter((s) => s.done).length;
	return {
		steps,
		done,
		total: steps.length,
		current: steps.find((s) => !s.done) ?? null,
		complete: done === steps.length,
	};
}

export function nextLabel(progress: RepoSetupProgress): string | null {
	const title = progress.current?.title;
	return title
		? `Next: ${title.charAt(0).toLowerCase()}${title.slice(1)}`
		: null;
}

const STEP_STAGES: Record<SetupStepKey, readonly SetupStage[]> = {
	install: ["install_app"],
	rules: ["turn_on_gate", "pick_rules"],
	check: ["verify_check"],
	responses: [],
};

const STAGE_WORDS: Record<SetupStage, string> = {
	connect_mcp: "Connecting",
	install_app: "Installing the GitHub App",
	sync_repos: "Syncing repos",
	pick_rules: "Picking rules",
	turn_on_gate: "Turning on rules",
	verify_check: "Running a first check",
};

export function stepCompletedAt(
	stages: SetupStages,
	key: SetupStepKey,
): string | null {
	for (const stage of STEP_STAGES[key]) {
		const state = stages[stage];
		if (state?.status === "completed") {
			return state.updatedAt;
		}
	}
	return null;
}

export function agentActivity(run: RepoAgentRun): {
	line: string;
	step: SetupStepKey | null;
} | null {
	let latest: { stage: SetupStage; state: SetupStageState } | null = null;
	for (const [stage, state] of Object.entries(run.stages) as [
		SetupStage,
		SetupStageState | undefined,
	][]) {
		if (
			state &&
			(state.status === "active" || state.status === "waiting") &&
			(!latest || state.updatedAt > latest.state.updatedAt)
		) {
			latest = { stage, state };
		}
	}
	if (!latest) {
		return null;
	}
	const found = latest;
	const step =
		SETUP_STEP_KEYS.find((key) => STEP_STAGES[key].includes(found.stage)) ??
		null;
	return { line: found.state.detail ?? STAGE_WORDS[found.stage], step };
}

export function formatStepTime(iso: string, zone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hour: "numeric",
		minute: "2-digit",
	})
		.format(new Date(iso))
		.replace(
			/\s?([AP])M$/i,
			(_match, half: string) => ` ${half.toLowerCase()}m`,
		);
}
