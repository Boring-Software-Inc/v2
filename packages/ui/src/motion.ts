export const UI_MOTION = {
	state: {
		duration: 0.16,
		ease: [0.2, 0.8, 0.2, 1],
	},
	position: {
		duration: 0.18,
		ease: [0.645, 0.045, 0.355, 1],
	},
	slide: {
		duration: 0.2,
		ease: [0.2, 0.8, 0.2, 1],
	},
	/** A full-page column swapping in or out, like a step of a guided flow. */
	column: {
		duration: 0.36,
		ease: [0.22, 1, 0.36, 1],
	},
	/** The column leaving: quicker and accelerating, so it clears the way. */
	columnExit: {
		duration: 0.18,
		ease: [0.4, 0, 1, 1],
	},
	/**
	 * Content riding one continuous track: the outgoing and incoming pages
	 * share this curve so they move as one strip, never leaving a gap. A sine
	 * ease in and out, so a page-wide move peaks near 40px a frame at 60Hz
	 * instead of strobing past at twice that.
	 */
	track: {
		duration: 0.66,
		ease: [0.37, 0, 0.63, 1],
	},
} as const;
