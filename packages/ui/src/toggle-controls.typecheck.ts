import type { CheckboxProps } from "./checkbox";
import type { SwitchProps } from "./switch";

function acceptsCheckbox(_props: CheckboxProps): void {}
function acceptsSwitch(_props: SwitchProps): void {}

acceptsCheckbox({ label: "Email updates" });
acceptsCheckbox({ ariaLabel: "Select all", checked: "indeterminate" });
acceptsCheckbox({
	ariaLabel: "External choice",
	form: "settings",
	name: "choice",
});
acceptsSwitch({ label: "Reduce motion", pending: true });
acceptsSwitch({ ariaLabelledBy: "motion-label" });
acceptsSwitch({ ariaLabel: "External switch", form: "settings", value: "on" });

// @ts-expect-error checkboxes require exactly one accessible naming path
acceptsCheckbox({});

// @ts-expect-error checkbox naming paths are mutually exclusive
acceptsCheckbox({ ariaLabel: "Email updates", label: "Email updates" });

// @ts-expect-error checkbox state is either controlled or initialized, never both
acceptsCheckbox({
	ariaLabel: "Email updates",
	checked: true,
	defaultChecked: true,
});

// @ts-expect-error switches require exactly one accessible naming path
acceptsSwitch({ pending: true });

// @ts-expect-error switch naming paths are mutually exclusive
acceptsSwitch({ ariaLabel: "Reduce motion", ariaLabelledBy: "motion-label" });

// @ts-expect-error switch state is either controlled or initialized, never both
acceptsSwitch({
	ariaLabel: "Reduce motion",
	checked: true,
	defaultChecked: true,
});
