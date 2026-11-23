import { UI_MOTION } from "@tripwire/ui/motion";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { ShaderDither } from "#/components/dither/shader-dither";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import { siteConfig } from "#/lib/site-config";

/** Fade up, hold, then hand off to the first step. */
const HOLD_MS = 2500;
const REDUCED_HOLD_MS = 900;

/**
 * The first screen: "welcome to" and the wordmark, centered, before the
 * questions start. It moves on by itself; any click or key moves on now.
 */
export function WelcomeIntro({ onDone }: { onDone: () => void }) {
	const reduceMotion = useReducedMotion();
	const done = useRef(onDone);
	done.current = onDone;

	useEffect(() => {
		let left = false;
		const leave = () => {
			if (!left) {
				left = true;
				done.current();
			}
		};
		const timer = window.setTimeout(
			leave,
			reduceMotion ? REDUCED_HOLD_MS : HOLD_MS,
		);
		window.addEventListener("keydown", leave);
		window.addEventListener("pointerdown", leave);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("keydown", leave);
			window.removeEventListener("pointerdown", leave);
		};
	}, [reduceMotion]);

	return (
		<div data-layout-role="onboarding-welcome">
			<ShaderDither
				className="onboarding-welcome-dither"
				mask="bottom"
				tone="soft"
			/>
			<motion.h1
				animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
				data-layout-role="onboarding-welcome-lockup"
				initial={
					reduceMotion
						? { opacity: 0 }
						: { opacity: 0, y: 8, filter: "blur(6px)" }
				}
				transition={UI_MOTION.column}
			>
				<span data-part="lead">{ONBOARDING_COPY.welcome.lead}</span>
				<span data-part="mark">
					<TripwireWordmark height={28} width={44} />
					<span>{siteConfig.name.toLowerCase()}</span>
				</span>
			</motion.h1>
		</div>
	);
}
