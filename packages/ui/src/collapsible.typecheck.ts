import type { AccordionProps, CollapsibleProps } from "./collapsible";

function acceptsCollapsible(_props: CollapsibleProps): void {}
function acceptsAccordion(_props: AccordionProps): void {}

acceptsCollapsible({
	children: "Details",
	defaultOpen: true,
	summary: "3 repositories",
	trigger: "Repository access",
});
acceptsCollapsible({
	children: "Details",
	header: {
		content: "Repository access",
		leading: "Forge",
		trigger: "Toggle",
		triggerPosition: "after-content",
	},
	open: false,
});

acceptsCollapsible({
	children: "Details",
	closedSummary: "4 of 5",
	trigger: "Where it applies",
	variant: "compact",
});

// @ts-expect-error a closed summary is part of the compact disclosure contract
acceptsCollapsible({
	children: "Details",
	closedSummary: "4 of 5",
	trigger: "Where it applies",
});

acceptsAccordion({
	defaultValue: ["members"],
	items: [{ content: "Member access", label: "Members", value: "members" }],
	multiple: true,
});
acceptsAccordion({
	disabled: true,
	items: [{ content: "Admin access", label: "Roles", value: "roles" }],
	value: ["roles"],
});

// @ts-expect-error collapsible state is either controlled or initialized, never both
acceptsCollapsible({
	children: "Details",
	defaultOpen: true,
	open: false,
	trigger: "Repository access",
});

// @ts-expect-error header anatomy cannot be combined with the simple trigger anatomy
acceptsCollapsible({
	children: "Details",
	header: { content: "Repository access", trigger: "Toggle" },
	trigger: "Repository access",
});

// @ts-expect-error summary belongs only to the simple trigger anatomy
acceptsCollapsible({
	children: "Details",
	header: { content: "Repository access", trigger: "Toggle" },
	summary: "3 repositories",
});

acceptsCollapsible({
	children: "Details",
	// @ts-expect-error raw keyboard handlers are not part of the semantic contract
	onKeyDown: () => undefined,
	trigger: "Repository access",
});

// @ts-expect-error accordion state is either controlled or initialized, never both
acceptsAccordion({
	defaultValue: ["members"],
	items: [{ content: "Member access", label: "Members", value: "members" }],
	value: ["roles"],
});

acceptsAccordion({
	items: [{ content: "Member access", label: "Members", value: "members" }],
	// @ts-expect-error accordion variants are finite design-system choices
	variant: "sidebar",
});
