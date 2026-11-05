export const COMPONENT_STATE_CONTRACT = {
	button: {
		rest: ["backgroundColor", "color"],
		hover: ["backgroundColor"],
		focusVisible: ["outlineColor", "outlineWidth"],
		pressed: ["backgroundColor", "scale"],
		open: ["backgroundColor"],
		disabled: ["color", "cursor"],
		pending: ["cursor", "ariaBusy"],
		reducedMotion: ["transitionDuration"],
	},
	field: {
		rest: ["borderColor", "backgroundColor"],
		focus: ["borderColor"],
		invalid: ["borderColor"],
		disabled: ["backgroundColor", "color", "cursor"],
	},
	overlay: {
		rest: ["backgroundColor", "borderColor"],
	},
	feedbackSelection: {
		rest: ["outlineColor", "outlineWidth", "boxShadow"],
	},
} as const;
