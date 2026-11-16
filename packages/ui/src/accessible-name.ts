export type AccessibleName =
	| { ariaLabel: string; ariaLabelledBy?: never }
	| { ariaLabel?: never; ariaLabelledBy: string };
