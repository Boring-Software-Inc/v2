import { createElement } from "react";
import type {
	AlertDialogProps,
	DestructiveDialogProps,
	DialogAction,
	DialogProps,
} from "./dialog";

function acceptsDialog(_dialog: DialogProps): void {}
function acceptsAlertDialog(_dialog: AlertDialogProps): void {}
function acceptsDestructiveDialog(_dialog: DestructiveDialogProps): void {}

const trigger = createElement("button", { type: "button" }, "Open");

const reusableSafeAction = {
	label: "Save",
	onAction: (details) => details.source,
} satisfies DialogAction;

const reusableNavigationAction = {
	href: "/settings",
	label: "Open settings",
	onNavigate: (_href, details) => details.source,
} satisfies DialogAction;

acceptsDialog({
	action: reusableSafeAction,
	children: "Dialog body",
	title: "Edit workspace",
	trigger,
});

acceptsDialog({
	action: reusableNavigationAction,
	children: "Dialog body",
	defaultOpen: true,
	title: "Edit workspace",
});

acceptsDialog({
	children: "Dialog body",
	onOpenChange: (_open, details) => details.source,
	open: true,
	title: "Edit workspace",
});

// @ts-expect-error controlled dialogs cannot also declare a default state
acceptsDialog({
	children: "Dialog body",
	defaultOpen: true,
	open: true,
	onOpenChange: () => undefined,
	title: "Edit workspace",
});

acceptsDialog({
	children: "Dialog body",
	// @ts-expect-error arbitrary footer content bypasses the action contract
	footer: null,
	title: "Edit workspace",
});

acceptsAlertDialog({
	confirmLabel: "Delete",
	description: "This cannot be undone.",
	onConfirm: (details) => details.source,
	title: "Delete workspace?",
	trigger,
});

acceptsDestructiveDialog({
	confirmLabel: "Delete",
	confirmText: "acme",
	description: "This cannot be undone.",
	onConfirm: (details) => details.source,
	onOpenChange: (_open, details) => details?.source,
	open: true,
	pendingLabel: "Deleting",
	secondaryAction: {
		label: "Export data",
		onAction: (details) => details.source,
	},
	title: "Delete Acme?",
});

acceptsDialog({
	children: "Dialog body",
	// @ts-expect-error raw class names cannot bypass the dialog contract
	className: "p-8",
	title: "Edit workspace",
});

acceptsAlertDialog({
	confirmLabel: "Delete",
	description: "This cannot be undone.",
	onConfirm: () => undefined,
	// @ts-expect-error an alert dialog requires an explicit trigger
	trigger: undefined,
	title: "Delete workspace?",
});

acceptsDestructiveDialog({
	confirmLabel: "Delete",
	description: "This cannot be undone.",
	onConfirm: () => undefined,
	onOpenChange: () => undefined,
	open: true,
	pendingLabel: "Deleting",
	// @ts-expect-error inline styles cannot bypass the destructive dialog contract
	style: {},
	title: "Delete Acme?",
});
