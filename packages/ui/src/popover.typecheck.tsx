import type { PopoverProps } from "./popover";

function acceptsPopoverProps(_props: PopoverProps): void {}

acceptsPopoverProps({
	children: "Body",
	trigger: <button type="button">Open</button>,
	triggerLabel: "Open details",
});

acceptsPopoverProps({
	children: "Preview",
	hoverTiming: "brief",
	interaction: "hover",
	trigger: <button type="button">Preview</button>,
	triggerLabel: "Preview details",
});

// @ts-expect-error popovers cannot be controlled and uncontrolled
acceptsPopoverProps({
	children: "Body",
	defaultOpen: true,
	open: true,
	trigger: <button type="button">Open</button>,
	triggerLabel: "Open details",
});

// @ts-expect-error hover timing belongs to the hover interaction contract
acceptsPopoverProps({
	children: "Body",
	hoverTiming: "brief",
	trigger: <button type="button">Open</button>,
	triggerLabel: "Open details",
});

acceptsPopoverProps({
	children: "Body",
	// @ts-expect-error headings are text contracts, not visual escape hatches
	title: <strong>Heading</strong>,
	trigger: <button type="button">Open</button>,
	triggerLabel: "Open details",
});

// @ts-expect-error every trigger needs a stable accessible name
acceptsPopoverProps({
	children: "Body",
	trigger: <button type="button">Open</button>,
});

acceptsPopoverProps({
	children: "Picker",
	focusMode: "trap",
	initialFocus: "first-field",
	trigger: <button type="button">Pick</button>,
	triggerLabel: "Pick a result",
});
