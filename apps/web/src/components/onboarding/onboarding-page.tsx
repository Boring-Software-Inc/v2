import { useQueryClient } from "@tanstack/react-query";
import { UI_MOTION } from "@tripwire/ui/motion";
import {
	AnimatePresence,
	LayoutGroup,
	motion,
	useReducedMotion,
} from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import {
	OnboardingDraftProvider,
	useOnboardingDraft,
} from "#/components/onboarding/onboarding-draft";
import {
	type OnboardingProgressNav,
	OnboardingProgressNavProvider,
} from "#/components/onboarding/onboarding-frame";
import {
	ONBOARDING_STEP_VIEWS,
	type StepView,
} from "#/components/onboarding/onboarding-steps";
import { prefetchStepPreview } from "#/components/onboarding/preview/prefetch-preview";
import { PreviewStage } from "#/components/onboarding/preview/preview-stage";
import { SkipSetup } from "#/components/onboarding/skip-setup";
import {
	ONBOARDING_BRAND_LAYOUT_ID,
	WelcomeIntro,
} from "#/components/onboarding/steps/welcome-intro";
import {
	type StepDirection,
	useOnboardingFlow,
} from "#/components/onboarding/use-onboarding-flow";
import { useMediaQuery } from "#/hooks/use-media-query";
import "./onboarding.css";
import "./onboarding-steps.css";

/**
 * Rises in, sinks out; going back runs it the other way. The leaving step
 * goes quickly so the two never sit on top of each other at half strength.
 */
const COLUMN_VARIANTS = {
	enter: (direction: StepDirection) => ({ opacity: 0, y: 16 * direction }),
	center: { opacity: 1, y: 0, transition: UI_MOTION.column },
	exit: (direction: StepDirection) => ({
		opacity: 0,
		y: 16 * direction,
		transition: UI_MOTION.columnExit,
	}),
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
	// Whether this visit opened on the welcome, so step 1 arrives with motion
	// rather than already in place.
	const openedOnWelcome = useRef(flow.step === "welcome");
	return (
		<OnboardingDraftProvider answers={flow.state.answers}>
			{/* The welcome fades out over the flow while its wordmark travels into
			    the brand lockup, so the hand-off has no cut. */}
			<LayoutGroup>
				<AnimatePresence initial={false}>
					{flow.step === "welcome" ? (
						<WelcomeIntro key="welcome" onDone={() => flow.advance()} />
					) : (
						<OnboardingLayout
							arriving={openedOnWelcome.current}
							flow={flow}
							key="flow"
						/>
					)}
				</AnimatePresence>
			</LayoutGroup>
		</OnboardingDraftProvider>
	);
}

function OnboardingLayout({
	flow,
	arriving,
}: {
	flow: ReturnType<typeof useOnboardingFlow>;
	/** Coming from the welcome: the first step rises in instead of being there. */
	arriving: boolean;
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
	// The panel opens and closes on the track's curve, in step with the page
	// riding in or out on it.
	const resize =
		reduceMotion || !stepChanged ? { duration: 0 } : UI_MOTION.track;
	// The steps either side load their preview data now, so whichever way the
	// user goes the next page arrives already rendered.
	const queryClient = useQueryClient();
	useEffect(() => {
		for (const neighbour of [
			flow.steps[flow.index + 1],
			flow.steps[flow.index - 1],
		]) {
			if (neighbour) {
				void prefetchStepPreview(neighbour, queryClient, flow.state);
			}
		}
	}, [flow.index, flow.state, flow.steps, queryClient]);
	const progressNav = useMemo<OnboardingProgressNav>(
		() => ({
			reached: flow.state.step,
			labelFor: (step) => ONBOARDING_STEP_VIEWS[step].label,
			visit: flow.visit,
		}),
		[flow.state.step, flow.visit],
	);

	return (
		<OnboardingProgressNavProvider value={progressNav}>
			<div data-layout-role="onboarding-shell">
				<motion.main
					animate={{ flexGrow: showPreview ? 0 : 1 }}
					data-layout-role="onboarding-column"
					initial={false}
					transition={resize}
				>
					<motion.div
						data-layout-role="onboarding-brand-slot"
						layoutId={ONBOARDING_BRAND_LAYOUT_ID}
						transition={{ layout: UI_MOTION.track }}
					>
						<BrandLockup />
					</motion.div>
					{/* Sized to where the column ends up, not where it is mid-resize, so
				    the form only rises and falls and never slides sideways. */}
					<div
						data-layout-role="onboarding-column-body"
						data-preview={showPreview ? "true" : "false"}
					>
						<div data-layout-role="onboarding-stage">
							{/* popLayout lifts the leaving step out of the layout, so the
						    arriving one is centred on its own height from the first frame. */}
							<AnimatePresence
								custom={flow.direction}
								initial={arriving}
								mode="popLayout"
							>
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
									variants={
										reduceMotion ? COLUMN_FADE_VARIANTS : COLUMN_VARIANTS
									}
								>
									<Form flow={flow} />
								</motion.section>
							</AnimatePresence>
						</div>
						<SkipSetup flow={flow} label={ONBOARDING_COPY.skipSetup} />
					</div>
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
		</OnboardingProgressNavProvider>
	);
}
