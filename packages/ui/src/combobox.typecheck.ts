import type { ComboboxProps } from "./combobox";

const OPTIONS = [
	{ label: "Alpha", value: "alpha" },
	{ label: "Beta", value: "beta" },
] as const;

function acceptsCombobox(_props: ComboboxProps<string>): void {}

acceptsCombobox({
	ariaLabel: "Repository",
	defaultValue: "alpha",
	disclosureLabel: "Show repositories",
	name: "repository",
	options: OPTIONS,
	required: true,
});
acceptsCombobox({
	ariaLabelledBy: "labels-heading",
	form: "settings",
	multiple: true,
	options: OPTIONS,
	readOnly: true,
	value: ["alpha"],
});
acceptsCombobox({
	ariaLabel: "Controlled search",
	onOpenChange: () => undefined,
	onQueryChange: () => undefined,
	open: false,
	options: OPTIONS,
	query: "alpha",
	value: null,
});

// @ts-expect-error comboboxes require exactly one accessible naming path
acceptsCombobox({ options: OPTIONS });

// @ts-expect-error combobox naming paths are mutually exclusive
acceptsCombobox({
	ariaLabel: "Repository",
	ariaLabelledBy: "repository-heading",
	options: OPTIONS,
});

// @ts-expect-error selected value is either controlled or initialized, never both
acceptsCombobox({
	ariaLabel: "Repository",
	defaultValue: "alpha",
	options: OPTIONS,
	value: "beta",
});

// @ts-expect-error query is either controlled or initialized, never both
acceptsCombobox({
	ariaLabel: "Repository",
	defaultQuery: "alpha",
	options: OPTIONS,
	query: "beta",
});

// @ts-expect-error popup state is either controlled or initialized, never both
acceptsCombobox({
	ariaLabel: "Repository",
	defaultOpen: true,
	open: false,
	options: OPTIONS,
});

// @ts-expect-error multiple comboboxes own an array value
acceptsCombobox({
	ariaLabel: "Labels",
	multiple: true,
	options: OPTIONS,
	value: "alpha",
});

// @ts-expect-error disclosure is supported on single-value inputs
acceptsCombobox({
	ariaLabel: "Labels",
	disclosureLabel: "Show labels",
	multiple: true,
	options: OPTIONS,
});

acceptsCombobox({
	ariaLabel: "Repository",
	options: OPTIONS,
	// @ts-expect-error variants are finite design-system choices
	variant: "sidebar",
});

acceptsCombobox({
	ariaLabel: "Repository",
	// @ts-expect-error raw styling is not part of the semantic contract
	className: "rounded",
	options: OPTIONS,
});
