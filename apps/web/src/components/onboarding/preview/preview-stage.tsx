import { UI_MOTION } from "@tripwire/ui/motion";
import {
	AnimatePresence,
	animate,
	motion,
	useMotionValue,
	useReducedMotion,
} from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { ShaderDither } from "#/components/dither/shader-dither";
import type { StepDirection } from "#/components/onboarding/use-onboarding-flow";

/** A preview page: steps that share a key keep their page in place. */
export interface PreviewSlide {
	key: string;
	node: ReactNode;
}

/**
 * How far the track moves: the window's left inset plus its 1000px width, so
 * a page starts and ends fully out of view. Matches the CSS offsets of the
 * track's before and after positions.
 */
const TRACK_SPAN = 1024;

const FADE_VARIANTS = {
	enter: { opacity: 0 },
	center: { opacity: 1 },
	exit: { opacity: 0 },
};

/** One move along the track: the page leaving, and which way it goes. */
interface TrackLeg {
	leaving: PreviewSlide | null;
	direction: StepDirection;
}

/**
 * The preview column. The dithered panel stays put; only what sits on it
 * moves. Reduced motion crossfades the pages instead.
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
			{/* The dither and the page fade in once, when the page first knows it
			    can show them, rather than popping in. Step changes then ride the
			    track. */}
			{live ? (
				<>
					<motion.div
						animate={{ opacity: 1 }}
						data-layout-role="onboarding-preview-dither"
						initial={{ opacity: 0 }}
						transition={UI_MOTION.column}
					>
						<ShaderDither mask="edges" tone="faint" />
					</motion.div>
					<motion.div
						animate={{ opacity: 1 }}
						data-layout-role="onboarding-track"
						initial={{ opacity: 0 }}
						transition={UI_MOTION.column}
					>
						{reduceMotion ? (
							<AnimatePresence initial={false}>
								{slide ? (
									<motion.div
										animate="center"
										data-layout-role="onboarding-track-item"
										data-position="center"
										exit="exit"
										initial="enter"
										key={slide.key}
										transition={UI_MOTION.state}
										variants={FADE_VARIANTS}
									>
										{slide.node}
									</motion.div>
								) : null}
							</AnimatePresence>
						) : (
							<PreviewTrack direction={direction} slide={slide} />
						)}
					</motion.div>
				</>
			) : null}
		</aside>
	);
}

/**
 * The pages sit side by side on one strip, and the strip is what moves: the
 * new page rides in from the left as the old one rides out to the right,
 * driven by a single value, so the two can never drift apart, gap, or
 * overlap. Going back runs the strip the other way.
 */
function PreviewTrack({
	slide,
	direction,
}: {
	slide: PreviewSlide | null;
	direction: StepDirection;
}) {
	const x = useMotionValue(0);
	const strip = useRef<HTMLDivElement>(null);
	const [shownKey, setShownKey] = useState(slide?.key ?? null);
	const [leg, setLeg] = useState<TrackLeg | null>(null);
	// The page on show as it last rendered, so a page that starts leaving
	// rides out looking as it did.
	const lastShown = useRef<PreviewSlide | null>(slide);

	const key = slide?.key ?? null;
	if (key !== shownKey) {
		setShownKey(key);
		setLeg({ leaving: lastShown.current, direction });
	}

	useLayoutEffect(() => {
		lastShown.current = slide;
	});

	// The strip follows the value directly, frame by frame.
	useLayoutEffect(() => {
		const place = (value: number) => {
			if (strip.current) {
				strip.current.style.transform = `translate3d(${value}px, 0, 0)`;
			}
		};
		place(x.get());
		return x.on("change", place);
	}, [x]);

	useLayoutEffect(() => {
		x.jump(0);
		if (strip.current) {
			strip.current.style.transform = "translate3d(0, 0, 0)";
		}
		if (!leg) {
			return;
		}
		const controls = animate(x, leg.direction * TRACK_SPAN, {
			...UI_MOTION.track,
			onComplete: () => setLeg(null),
		});
		return () => controls.stop();
	}, [leg, x]);

	const arriving = leg ? (leg.direction > 0 ? "before" : "after") : "center";
	return (
		<div data-layout-role="onboarding-track-strip" ref={strip}>
			{leg?.leaving && leg.leaving.key !== key ? (
				<div
					data-layout-role="onboarding-track-item"
					data-position="center"
					key={leg.leaving.key}
				>
					{leg.leaving.node}
				</div>
			) : null}
			{slide ? (
				<div
					data-layout-role="onboarding-track-item"
					data-position={arriving}
					key={slide.key}
				>
					{slide.node}
				</div>
			) : null}
		</div>
	);
}
