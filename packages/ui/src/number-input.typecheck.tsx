import type { NumberInputProps } from "./number-input";

function acceptsNumberInput(_props: NumberInputProps): void {}

acceptsNumberInput({ ariaLabel: "Review days", defaultValue: 7 });
acceptsNumberInput({ ariaLabelledBy: "review-days-label", value: 14 });
acceptsNumberInput({ ariaLabel: "Optional amount", value: null });

// @ts-expect-error number inputs require exactly one accessible naming path
acceptsNumberInput({ defaultValue: 7 });

// @ts-expect-error number input naming paths are mutually exclusive
acceptsNumberInput({
	ariaLabel: "Review days",
	ariaLabelledBy: "review-days-label",
	defaultValue: 7,
});

// @ts-expect-error controlled and default state are mutually exclusive
acceptsNumberInput({
	ariaLabel: "Review days",
	defaultValue: 7,
	value: 14,
});

// @ts-expect-error control ids are owned by ui-sdk so step relationships cannot drift
acceptsNumberInput({ ariaLabel: "Review days", id: "review-days", value: 14 });
