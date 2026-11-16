import type { FieldErrorProps, InputProps, TextareaProps } from "./field";

function acceptsInput(_props: InputProps): void {}
function acceptsTextarea(_props: TextareaProps): void {}
function acceptsFieldError(_props: FieldErrorProps): void {}

acceptsInput({ ariaLabel: "Search", defaultValue: "" });
acceptsInput({ ariaLabelledBy: "name-label", value: "Grim" });
acceptsInput({ labelledByField: true, name: "email" });
acceptsTextarea({ ariaLabel: "Feedback", rows: 4, value: "" });
acceptsTextarea({ labelledByField: true, name: "bio" });
acceptsFieldError({ match: "valueMissing" });
acceptsFieldError({ match: true });

// @ts-expect-error validation matching is a finite native-validity contract
acceptsFieldError({ match: "serverError" });

// @ts-expect-error text controls require one declared accessible naming path
acceptsInput({ defaultValue: "" });

// @ts-expect-error text-control naming paths are mutually exclusive
acceptsInput({
	ariaLabel: "Search",
	ariaLabelledBy: "search-label",
	defaultValue: "",
});

acceptsTextarea({
	ariaLabel: "Feedback",
	// @ts-expect-error field association cannot be mixed with a direct name
	labelledByField: true,
	value: "",
});

// @ts-expect-error controlled and default text state are mutually exclusive
acceptsInput({
	ariaLabel: "Search",
	defaultValue: "initial",
	value: "controlled",
});

acceptsInput({
	ariaLabel: "Search",
	// @ts-expect-error raw classes cannot bypass the text-control contract
	className: "px-8",
});

acceptsTextarea({
	ariaLabel: "Feedback",
	// @ts-expect-error callers cannot override multiline corner geometry
	style: { borderRadius: 999 },
});

acceptsTextarea({
	ariaLabel: "Feedback",
	// @ts-expect-error callers cannot select a different corner utility
	className: "rounded-pill",
});
