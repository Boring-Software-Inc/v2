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
	/**
	 * Content riding one continuous track: the outgoing and incoming pages
	 * share this curve so they move as one strip, never leaving a gap.
	 */
	track: {
		duration: 0.62,
		ease: [0.65, 0, 0.35, 1],
	},
} as const;
