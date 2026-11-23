import { UI_MOTION } from "@tripwire/ui/motion";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import {
	OnboardingDraftProvider,
	useOnboardingDraft,
} from "#/components/onboarding/onboarding-draft";
import {
	ONBOARDING_STEP_VIEWS,
	type StepView,
} from "#/components/onboarding/onboarding-steps";
import { PreviewStage } from "#/components/onboarding/preview/preview-stage";
import { SkipSetup } from "#/components/onboarding/skip-setup";
import { WelcomeIntro } from "#/components/onboarding/steps/welcome-intro";
import {
	type StepDirection,
	useOnboardingFlow,
} from "#/components/onboarding/use-onboarding-flow";
import { useMediaQuery } from "#/hooks/use-media-query";
import "./onboarding.css";
import "./onboarding-steps.css";

/** Rises in, sinks out; going back runs it the other way. */
const COLUMN_VARIANTS = {
	enter: (direction: StepDirection) => ({ opacity: 0, y: 16 * direction }),
	center: { opacity: 1, y: 0 },
	exit: (direction: StepDirection) => ({ opacity: 0, y: 16 * direction }),
};

/** Reduced motion: the column only fades. */
const COLUMN_FADE_VARIANTS = {
	enter: { opacity: 0 },
	center: { opacity: 1 },
	exit: { opacity: 0 },
};

const PREVIEW_MIN_WIDTH = "(min-width: 64rem)";

export function OnboardingPage() {
	const flow = useOnboardingFlow();
	return (
		<OnboardingDraftProvider answers={flow.state.answers}>
			{flow.step === "welcome" ? (
				<WelcomeIntro onDone={() => flow.advance()} />
			) : (
				<OnboardingLayout flow={flow} />
			)}
		</OnboardingDraftProvider>
	);
}

function OnboardingLayout({
	flow,
}: {
	flow: ReturnType<typeof useOnboardingFlow>;
}) {
	const [draft] = useOnboardingDraft();
	const reduceMotion = useReducedMotion();
	const wideScreen = useMediaQuery(PREVIEW_MIN_WIDTH);
	const view: StepView = ONBOARDING_STEP_VIEWS[flow.step];
	const previewKey = view.previewKey?.({ state: flow.state, draft }) ?? null;
	const showPreview = previewKey !== null;
	const Preview = view.Preview;
	const Form = view.Form;
	// The column and preview resize only when the step changes. A width that
	// settles on mount or on a window resize snaps instead of growing in.
	const lastStep = useRef(flow.step);
	const stepChanged = lastStep.current !== flow.step;
	useEffect(() => {
		lastStep.current = flow.step;
	});
	const resize =
		reduceMotion || !stepChanged ? { duration: 0 } : UI_MOTION.column;

	return (
		<div data-layout-role="onboarding-shell">
			<motion.main
				animate={{ flexGrow: showPreview ? 0 : 1 }}
				data-layout-role="onboarding-column"
				initial={false}
				transition={resize}
			>
				<BrandLockup />
				<div data-layout-role="onboarding-stage">
					<AnimatePresence custom={flow.direction} initial={false}>
						<motion.section
							animate="center"
							aria-label={view.label}
							custom={flow.direction}
							data-layout-role="onboarding-step"
							data-wide={view.wide ? "true" : "false"}
							exit="exit"
							initial="enter"
							key={flow.step}
							transition={reduceMotion ? UI_MOTION.state : UI_MOTION.column}
							variants={reduceMotion ? COLUMN_FADE_VARIANTS : COLUMN_VARIANTS}
						>
							<Form flow={flow} />
						</motion.section>
					</AnimatePresence>
				</div>
				<SkipSetup flow={flow} label={ONBOARDING_COPY.skipSetup} />
			</motion.main>
			<motion.div
				animate={{ flexGrow: showPreview ? 1 : 0 }}
				data-layout-role="onboarding-preview-slot"
				initial={false}
				transition={resize}
			>
				<PreviewStage
					direction={flow.direction}
					live={wideScreen}
					slide={
						previewKey && Preview
							? { key: previewKey, node: <Preview flow={flow} /> }
							: null
					}
				/>
			</motion.div>
		</div>
	);
}
