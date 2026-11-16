import type { MenuEntry, MenuProps } from "./menu";

function acceptsMenuProps(_props: MenuProps): void {}
function acceptsMenuEntry(_entry: MenuEntry): void {}

acceptsMenuProps({
	ariaLabel: "Actions",
	items: [],
	trigger: <button type="button">Actions</button>,
});

// @ts-expect-error menus cannot be controlled and uncontrolled
acceptsMenuProps({
	ariaLabel: "Actions",
	defaultOpen: true,
	items: [],
	open: true,
	trigger: <button type="button">Actions</button>,
});

// @ts-expect-error menus require exactly one accessible naming path
acceptsMenuProps({
	items: [],
	trigger: <button type="button">Actions</button>,
});

// @ts-expect-error menu naming paths are mutually exclusive
acceptsMenuProps({
	ariaLabel: "Actions",
	ariaLabelledBy: "actions-label",
	items: [],
	trigger: <button type="button">Actions</button>,
});

acceptsMenuEntry({
	checked: true,
	// @ts-expect-error checkbox rows cannot be controlled and uncontrolled
	defaultChecked: false,
	label: "Grid",
	type: "checkbox",
	value: "grid",
});

acceptsMenuEntry({
	defaultChecked: true,
	label: "Grid",
	type: "checkbox",
	value: "grid",
});

acceptsMenuEntry({
	label: "Grid",
	// @ts-expect-error checkbox rows do not support shortcuts
	shortcut: "G",
	type: "checkbox",
	value: "grid",
});

// @ts-expect-error radio groups cannot be controlled and uncontrolled
acceptsMenuEntry({
	defaultValue: "comfortable",
	options: [{ label: "Comfortable", value: "comfortable" }],
	type: "radio-group",
	value: "comfortable",
	valueKey: "density",
});

acceptsMenuEntry({
	options: [
		{
			label: "Comfortable",
			// @ts-expect-error radio rows do not support shortcuts
			shortcut: "C",
			value: "comfortable",
		},
	],
	type: "radio-group",
	valueKey: "density",
});
