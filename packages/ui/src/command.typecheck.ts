import type {
	CommandDialogProps,
	CommandItemData,
	CommandLinkItem,
	CommandProps,
} from "./command";

function acceptsCommandItem(_item: CommandItemData): void {}

acceptsCommandItem({
	confirmation: {
		confirmLabel: "Sign out",
		title: "Sign out of Tripwire?",
	},
	label: "Sign out",
	onAction: () => undefined,
	tone: "destructive",
	value: "sign-out",
});

const controlledCommand = {
	ariaLabel: "Search Tripwire",
	items: [],
	query: "settings",
} satisfies CommandProps;

const uncontrolledCommand = {
	ariaLabel: "Search Tripwire",
	defaultQuery: "settings",
	items: [],
} satisfies CommandProps;

void controlledCommand;
void uncontrolledCommand;

// @ts-expect-error command query cannot be controlled and uncontrolled
const invalidQueryState: CommandProps = {
	ariaLabel: "Search Tripwire",
	defaultQuery: "settings",
	items: [],
	query: "settings",
};

void invalidQueryState;

const commandLink = {
	href: "/settings",
	label: "Open settings",
	type: "link",
	value: "settings",
} satisfies CommandLinkItem;

void commandLink;

// @ts-expect-error command links require native destinations
const commandLinkWithoutHref: CommandLinkItem = {
	label: "Open settings",
	type: "link",
	value: "settings",
};

void commandLinkWithoutHref;

const controlledDialog = {
	ariaLabel: "Search Tripwire",
	items: [],
	open: true,
	title: "Command palette",
} satisfies CommandDialogProps;

void controlledDialog;

// @ts-expect-error command dialogs cannot be controlled and uncontrolled
const invalidDialogState: CommandDialogProps = {
	ariaLabel: "Search Tripwire",
	defaultOpen: true,
	items: [],
	open: true,
	title: "Command palette",
};

void invalidDialogState;

// @ts-expect-error destructive command actions require confirmation copy
acceptsCommandItem({
	label: "Sign out",
	onAction: () => undefined,
	tone: "destructive",
	value: "sign-out",
});

// @ts-expect-error neutral command actions cannot carry destructive confirmation
acceptsCommandItem({
	confirmation: {
		confirmLabel: "Continue",
		title: "Continue?",
	},
	label: "Open settings",
	onAction: () => undefined,
	tone: "neutral",
	value: "settings",
});
