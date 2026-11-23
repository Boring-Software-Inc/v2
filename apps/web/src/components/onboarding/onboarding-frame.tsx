import { ONBOARDING_STEPS, type OnboardingStep } from "@tripwire/contracts";
import { PageTitle, SupportingText } from "@tripwire/ui/typography";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
} from "react";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";

/** What the dots need to move between steps, supplied by the onboarding page. */
export interface OnboardingProgressNav {
	/** The furthest step reached; dots up to it can be visited. */
	reached: OnboardingStep;
	labelFor: (step: OnboardingStep) => string;
	visit: (step: OnboardingStep) => void;
	/** True once, for the step a dot just moved the flow to: its dots take focus. */
	takeFocus: (step: OnboardingStep) => boolean;
}

const ProgressNavContext = createContext<OnboardingProgressNav | null>(null);

export const OnboardingProgressNavProvider = ProgressNavContext.Provider;

/**
 * The progress dots: one per step the user will see, the current one long.
 * A dot for a step already reached is a button back (or forward again) to
 * it, and grows under the pointer; later steps stay plain dots.
 */
export function OnboardingProgress({
	steps,
	current,
}: {
	steps: readonly OnboardingStep[];
	current: OnboardingStep;
}) {
	const nav = useContext(ProgressNavContext);
	const currentDot = useRef<HTMLButtonElement>(null);
	// A dot unmounts with the step it belongs to, so after one is used the
	// matching dot on the new step takes focus, and the keyboard stays put.
	useEffect(() => {
		if (nav?.takeFocus(current)) {
			currentDot.current?.focus();
		}
	}, [nav, current]);
	const at = steps.indexOf(current);
	const furthest = ONBOARDING_STEPS.indexOf(nav?.reached ?? current);
	return (
		<nav
			aria-label={ONBOARDING_COPY.progressNav}
			data-layout-role="onboarding-progress"
		>
			{steps
				.filter((step) => step !== "welcome")
				.map((step) => {
					const index = steps.indexOf(step);
					const state =
						index < at ? "done" : index === at ? "current" : "upcoming";
					const reachable =
						nav !== null && ONBOARDING_STEPS.indexOf(step) <= furthest;
					return reachable ? (
						<button
							ref={state === "current" ? currentDot : undefined}
							data-part="step"
							aria-current={state === "current" ? "step" : undefined}
							aria-label={nav.labelFor(step)}
							data-state={state}
							key={step}
							onClick={() => nav.visit(step)}
							type="button"
						>
							<span data-part="dot" />
						</button>
					) : (
						<span
							aria-hidden="true"
							data-part="step"
							data-state={state}
							key={step}
						>
							<span data-part="dot" />
						</span>
					);
				})}
		</nav>
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
