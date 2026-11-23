import type { OnboardingStep } from "@tripwire/contracts";
import type { ComponentType } from "react";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import type { OnboardingDraft } from "#/components/onboarding/onboarding-draft";
import { HomePreview } from "#/components/onboarding/preview/home-preview";
import { AboutStep } from "#/components/onboarding/steps/about-step";
import {
	AgentsPreview,
	AgentsStep,
} from "#/components/onboarding/steps/agents-step";
import {
	CheckPreview,
	CheckStep,
} from "#/components/onboarding/steps/check-step";
import {
	ConnectPreview,
	ConnectStep,
	connectPreviewKey,
} from "#/components/onboarding/steps/connect-step";
import { ProblemsStep } from "#/components/onboarding/steps/problems-step";
import {
	ResponsesPreview,
	ResponsesStep,
} from "#/components/onboarding/steps/responses-step";
import {
	RulesPreview,
	RulesStep,
} from "#/components/onboarding/steps/rules-step";
import {
	WorkflowPreview,
	WorkflowStep,
} from "#/components/onboarding/steps/workflow-step";
import {
	WorkspacePreview,
	WorkspaceStep,
} from "#/components/onboarding/steps/workspace-step";
import type { useOnboardingFlow } from "#/components/onboarding/use-onboarding-flow";
import type { OnboardingState } from "#/lib/onboarding-flow.functions";

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;

export interface StepViewProps {
	flow: OnboardingFlow;
}

export interface StepView {
	/** The step's accessible name, its title. */
	label: string;
	Form: ComponentType<StepViewProps>;
	Preview?: ComponentType<StepViewProps>;
	/** Which preview page shows; steps sharing a key keep the page in place. */
	previewKey?: (input: {
		state: OnboardingState;
		draft: OnboardingDraft;
	}) => string | null;
	wide?: boolean;
}

function OrgHomePreview({ flow }: StepViewProps) {
	return <HomePreview org={flow.state.orgSlug ?? flow.state.personalOrgSlug} />;
}

export const ONBOARDING_STEP_VIEWS = {
	welcome: {
		label: ONBOARDING_COPY.problems.title,
		Form: ProblemsStep,
		wide: true,
	},
	problems: {
		label: ONBOARDING_COPY.problems.title,
		Form: ProblemsStep,
		wide: true,
	},
	about: {
		label: ONBOARDING_COPY.about.title,
		Form: AboutStep,
		Preview: OrgHomePreview,
		previewKey: () => "home",
	},
	workspace: {
		label: ONBOARDING_COPY.workspace.title,
		Form: WorkspaceStep,
		Preview: WorkspacePreview,
		previewKey: () => "home",
	},
	connect: {
		label: ONBOARDING_COPY.connect.title,
		Form: ConnectStep,
		Preview: ConnectPreview,
		previewKey: connectPreviewKey,
	},
	rules: {
		label: ONBOARDING_COPY.rules.title,
		Form: RulesStep,
		Preview: RulesPreview,
		previewKey: () => "rules",
	},
	check: {
		label: ONBOARDING_COPY.check.title,
		Form: CheckStep,
		Preview: CheckPreview,
		previewKey: () => "check",
	},
	responses: {
		label: ONBOARDING_COPY.responses.title,
		Form: ResponsesStep,
		Preview: ResponsesPreview,
		previewKey: () => "responses",
	},
	workflow: {
		label: ONBOARDING_COPY.workflow.title,
		Form: WorkflowStep,
		Preview: WorkflowPreview,
		previewKey: () => "workflow",
	},
	agents: {
		label: ONBOARDING_COPY.agents.title,
		Form: AgentsStep,
		Preview: AgentsPreview,
		previewKey: ({ draft }) => `agent-${draft.agent}`,
	},
} satisfies Record<OnboardingStep, StepView>;
