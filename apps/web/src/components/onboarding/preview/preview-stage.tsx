import { UI_MOTION } from "@tripwire/ui/motion";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { ShaderDither } from "#/components/dither/shader-dither";
import type { StepDirection } from "#/components/onboarding/use-onboarding-flow";

/** A preview page: steps that share a key keep their page in place. */
export interface PreviewSlide {
	key: string;
	node: ReactNode;
}

/**
 * How far a slide travels: the window's left inset plus its 1000px width, so
 * a slide starts and ends fully out of view and every slide moves the same
 * distance at the same speed, like cars on one track.
 */
const TRACK_SPAN = 1024;

const TRACK_VARIANTS = {
	enter: (direction: StepDirection) => ({ x: -direction * TRACK_SPAN }),
	center: { x: 0 },
	exit: (direction: StepDirection) => ({ x: direction * TRACK_SPAN }),
};

const FADE_VARIANTS = {
	enter: { opacity: 0 },
	center: { opacity: 1 },
	exit: { opacity: 0 },
};

/**
 * The preview column. The dithered panel stays put; only what sits on it
 * moves. A new page rides in from the left while the old one rides out to
 * the right, both on the same curve, so the hand-off has no gap and no cut.
 * Going back runs the track the other way.
 */
export function PreviewStage({
	slide,
	direction,
	live,
}: {
	slide: PreviewSlide | null;
	direction: StepDirection;
	/** False until the screen is known to be wide enough: the panel holds its
	 * place from the first paint and its contents arrive once it is. */
	live: boolean;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<aside data-layout-role="onboarding-preview">
			{live ? (
				<>
					<div data-layout-role="onboarding-preview-dither">
						<ShaderDither mask="edges" tone="faint" />
					</div>
					<div data-layout-role="onboarding-track">
						<AnimatePresence custom={direction} initial={false}>
							{slide ? (
								<motion.div
									animate="center"
									custom={direction}
									data-layout-role="onboarding-track-item"
									exit="exit"
									initial="enter"
									key={slide.key}
									transition={reduceMotion ? UI_MOTION.state : UI_MOTION.track}
									variants={reduceMotion ? FADE_VARIANTS : TRACK_VARIANTS}
								>
									{slide.node}
								</motion.div>
							) : null}
						</AnimatePresence>
					</div>
				</>
			) : null}
		</aside>
	);
}
