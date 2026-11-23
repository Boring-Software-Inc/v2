import type { OnboardingStep } from "@tripwire/contracts";
import { PageTitle, SupportingText } from "@tripwire/ui/typography";
import type { ReactNode } from "react";

/**
 * The progress dots: one per step the user will see, the current one long.
 * Decorative, since the step title already says where they are.
 */
export function OnboardingProgress({
	steps,
	current,
}: {
	steps: readonly OnboardingStep[];
	current: OnboardingStep;
}) {
	const at = steps.indexOf(current);
	return (
		<div aria-hidden="true" data-layout-role="onboarding-progress">
			{steps
				.filter((step) => step !== "welcome")
				.map((step) => {
					const index = steps.indexOf(step);
					const state =
						index < at ? "done" : index === at ? "current" : "upcoming";
					return <span data-state={state} key={step} />;
				})}
		</div>
	);
}

export function OnboardingStepHeader({
	steps,
	current,
	title,
	sub,
}: {
	steps: readonly OnboardingStep[];
	current: OnboardingStep;
	title: string;
	sub: ReactNode;
}) {
	return (
		<header data-layout-role="onboarding-step-header">
			<OnboardingProgress current={current} steps={steps} />
			<PageTitle>{title}</PageTitle>
			<SupportingText>{sub}</SupportingText>
		</header>
	);
}
