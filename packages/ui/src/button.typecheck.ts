import type { ActionLinkProps, ButtonProps, IconButtonProps } from "./button";

function acceptsButton(_button: ButtonProps): void {}
function acceptsIconButton(_button: IconButtonProps): void {}
function acceptsActionLink(_link: ActionLinkProps): void {}

acceptsButton({
	children: "Save",
	onAction: () => undefined,
	variant: "primary",
});

acceptsButton({
	children: "Delete workspace",
	confirmation: {
		confirmLabel: "Delete",
		title: "Delete workspace?",
	},
	onAction: () => undefined,
	variant: "destructive",
});

acceptsButton({
	children: "Settings",
	href: "/settings",
	onNavigate: () => undefined,
});

acceptsIconButton({
	icon: null,
	label: "Close panel",
	onAction: () => undefined,
});

acceptsIconButton({
	confirmation: {
		confirmLabel: "Delete",
		title: "Delete workspace?",
	},
	icon: null,
	label: "Delete workspace",
	onAction: () => undefined,
	variant: "destructive",
});

acceptsActionLink({
	children: "Preview portal",
	href: "/appeals/preview",
	onNavigate: () => undefined,
	variant: "ghost",
});

acceptsButton({
	children: "Save",
	// @ts-expect-error raw class names cannot bypass the finite visual contract
	className: "px-7",
	onAction: () => undefined,
});

// @ts-expect-error inline styles cannot bypass the finite visual contract
acceptsButton({ children: "Save", onAction: () => undefined, style: {} });

// @ts-expect-error destructive buttons require confirmation copy
acceptsButton({
	children: "Delete workspace",
	onAction: () => undefined,
	variant: "destructive",
});

// @ts-expect-error safe actions cannot carry destructive confirmation
acceptsButton({
	children: "Save",
	confirmation: {
		confirmLabel: "Continue",
		title: "Continue?",
	},
	onAction: () => undefined,
	variant: "primary",
});

// @ts-expect-error navigation buttons cannot run action callbacks
acceptsButton({
	children: "Settings",
	href: "/settings",
	onAction: () => undefined,
});

// @ts-expect-error destructive buttons cannot navigate
acceptsButton({
	children: "Delete workspace",
	confirmation: {
		confirmLabel: "Delete",
		title: "Delete workspace?",
	},
	href: "/settings",
	onAction: () => undefined,
	variant: "destructive",
});

// @ts-expect-error icon-only buttons require an accessible label
acceptsIconButton({
	icon: null,
	onAction: () => undefined,
});

// @ts-expect-error destructive icon buttons require confirmation copy
acceptsIconButton({
	icon: null,
	label: "Delete workspace",
	onAction: () => undefined,
	variant: "destructive",
});

acceptsActionLink({
	children: "Preview portal",
	href: "/appeals/preview",
	// @ts-expect-error links cannot opt into destructive action styling
	variant: "destructive",
});

acceptsActionLink({
	children: "Preview portal",
	// @ts-expect-error raw class names cannot bypass the finite link contract
	className: "px-7",
	href: "/appeals/preview",
});

acceptsActionLink({
	children: "Preview portal",
	href: "/appeals/preview",
	// @ts-expect-error inline styles cannot bypass the finite link contract
	style: {},
});
