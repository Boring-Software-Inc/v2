import { type ChangeDetails, definePrimitive, dispatch } from "@ui-sdk/core";
import { type ConfirmOptions, confirm } from "@ui-sdk/core/alert-dialog";
import { Button as BehaviorButton } from "@ui-sdk/react/button";
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import { Toggle } from "@ui-sdk/react/toggle";
import type {
	ComponentProps,
	KeyboardEvent,
	MouseEvent,
	PointerEvent,
	ReactNode,
	Ref,
} from "react";
import { Icon, Pending } from "./icon";
import {
	type InteractionDetails,
	interactionDetails,
	shouldConfirmLocally,
} from "./interaction";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const BUTTON_GLASS = {
	primary: "glass glass-ink",
	destructive: "glass glass-coral",
	secondary: undefined,
	ghost: undefined,
} satisfies Record<ButtonVariant, string | undefined>;
export type ButtonSize = "small" | "medium" | "large";

type NavigationReason = "imperative" | "link-press";

interface NavigationLinkOptions {
	disabled?: boolean;
	href: string;
	onOpen?: (href: string, details: ChangeDetails<NavigationReason>) => unknown;
}

const navigationLink = definePrimitive({
	name: "action-link",
	options: {
		disabled: "boolean",
		href: "string",
		onOpen: "callback",
	},
	state: (options: NavigationLinkOptions) => ({
		disabled: options.disabled ?? false,
	}),
	sync: (options) => ({ disabled: options.disabled ?? false }),
	api(context) {
		return {
			open: (event?: globalThis.Event) => {
				if (context.store.get().disabled) return false;
				return dispatch(context, "onOpen", context.options().href, {
					event,
					reason: event ? "link-press" : "imperative",
				});
			},
		};
	},
	agent: { actions: ["open"] },
	slots: (slot) => ({
		root: slot({
			attrs: (state) => ({
				"aria-disabled": state.disabled ? "true" : undefined,
			}),
		}),
	}),
});

interface ButtonCommonProps {
	children: ReactNode;
	ariaLabel?: string;
	ariaKeyShortcuts?: string;
	describedBy?: string;
	disabled?: boolean;
	focusableWhenDisabled?: boolean;
	form?: string;
	leadingIcon?: ReactNode;
	name?: string;
	pending?: boolean;
	pendingAnnouncement?: string;
	pendingLabel?: string;
	reservePendingWidth?: boolean;
	size?: ButtonSize;
	trailingIcon?: ReactNode;
	type?: "button" | "submit" | "reset";
	value?: string;
}

interface SafeButtonProps extends ButtonCommonProps {
	variant?: Exclude<ButtonVariant, "destructive">;
	confirmation?: never;
	href?: never;
	onAction?: (details: InteractionDetails) => unknown;
	onNavigate?: never;
	openInNewTab?: never;
}

interface DestructiveButtonProps extends ButtonCommonProps {
	variant: "destructive";
	confirmation: ConfirmOptions;
	href?: never;
	onAction: (details: InteractionDetails) => unknown;
	onNavigate?: never;
	openInNewTab?: never;
}

interface NavigationButtonProps extends ButtonCommonProps {
	confirmation?: never;
	reservePendingWidth?: never;
	href: string;
	onAction?: never;
	onNavigate?: (href: string, details: InteractionDetails) => unknown;
	openInNewTab?: boolean;
	variant?: Exclude<ButtonVariant, "destructive">;
}

export type ButtonProps =
	| SafeButtonProps
	| DestructiveButtonProps
	| NavigationButtonProps;

interface InjectedTriggerProps {
	"aria-controls"?: string;
	"aria-expanded"?: boolean;
	"aria-haspopup"?: "dialog" | "menu" | "listbox" | "tree" | "grid" | true;
	"data-closed"?: string;
	"data-open"?: string;
	id?: string;
	onClick?: (event: MouseEvent<HTMLElement>) => unknown;
	onKeyDown?: (event: KeyboardEvent<HTMLElement>) => unknown;
	onPointerDown?: (event: PointerEvent<HTMLElement>) => unknown;
	ref?: Ref<HTMLElement>;
	tabIndex?: number;
}

function ButtonContent({
	children,
	leadingIcon,
	pendingLabel,
	reservePendingWidth,
	trailingIcon,
}: Pick<
	ButtonCommonProps,
	| "children"
	| "leadingIcon"
	| "pendingLabel"
	| "reservePendingWidth"
	| "trailingIcon"
>) {
	if (reservePendingWidth) {
		return (
			<span data-slot="button-state-stack">
				<span data-slot="button-idle">
					{leadingIcon ? (
						<span aria-hidden="true" data-slot="button-icon">
							{leadingIcon}
						</span>
					) : null}
					<span data-slot="button-state-label">{children}</span>
					{trailingIcon ? (
						<span aria-hidden="true" data-slot="button-icon">
							{trailingIcon}
						</span>
					) : null}
				</span>
				<span aria-hidden="true" data-slot="button-pending">
					<Icon icon={Pending} motion="spin" />
					<span data-slot="button-state-label">{pendingLabel ?? children}</span>
				</span>
			</span>
		);
	}
	return (
		<>
			{leadingIcon ? (
				<span aria-hidden="true" data-show="idle" data-slot="button-icon">
					{leadingIcon}
				</span>
			) : null}
			<span
				data-show={pendingLabel ? "idle" : undefined}
				data-slot="button-label"
			>
				{children}
			</span>
			{pendingLabel ? <span data-show="pending">{pendingLabel}</span> : null}
			{trailingIcon ? (
				<span aria-hidden="true" data-show="idle" data-slot="button-icon">
					{trailingIcon}
				</span>
			) : null}
		</>
	);
}

interface NavigationLinkProps {
	ariaLabel?: string;
	children: ReactNode;
	describedBy?: string;
	disabled?: boolean;
	focusableWhenDisabled?: boolean;
	href: string;
	injected?: InjectedTriggerProps;
	onNavigate?: (href: string, details: InteractionDetails) => unknown;
	openInNewTab?: boolean;
	size: ButtonSize;
	slot: "action-link" | "button";
	variant: Exclude<ButtonVariant, "destructive">;
}

function NavigationLink({
	ariaLabel,
	children,
	describedBy,
	disabled = false,
	focusableWhenDisabled = false,
	href,
	injected,
	onNavigate,
	openInNewTab = false,
	size,
	slot,
	variant,
}: NavigationLinkProps) {
	const link = usePrimitive(navigationLink, {
		disabled,
		href,
		onOpen: (nextHref, details) => {
			if (onNavigate) {
				return onNavigate(nextHref, interactionDetails(details));
			}
			window.location.assign(nextHref);
		},
	});
	const rootProps = {
		"aria-describedby": describedBy,
		"aria-label": ariaLabel,
		className: BUTTON_GLASS[variant],
		"data-size": size,
		"data-slot": slot,
		"data-variant": variant,
		href,
		id: injected?.id,
		onClick: (event: MouseEvent<HTMLAnchorElement>) => {
			injected?.onClick?.(event);
			if (event.defaultPrevented) return;
			if (disabled) {
				event.preventDefault();
				return;
			}
			if (onNavigate) {
				event.preventDefault();
				return link.api.open(event.nativeEvent);
			}
		},
		onKeyDown: injected?.onKeyDown,
		onPointerDown: injected?.onPointerDown,
		rel: openInNewTab ? "noreferrer" : undefined,
		tabIndex:
			injected?.tabIndex ??
			(disabled && !focusableWhenDisabled ? -1 : undefined),
		target: openInNewTab ? "_blank" : undefined,
		children,
	} as ComponentProps<"a">;
	return usePart(link, "root", {}, rootProps, "a");
}

export function Button(props: ButtonProps) {
	const injected = props as ButtonProps & InjectedTriggerProps;
	const {
		children,
		ariaLabel,
		ariaKeyShortcuts,
		describedBy,
		disabled,
		focusableWhenDisabled,
		form,
		leadingIcon,
		name,
		pending = false,
		pendingAnnouncement,
		pendingLabel,
		reservePendingWidth,
		size = "medium",
		trailingIcon,
		type = "button",
		value,
		variant = "secondary",
	} = props;
	const content = (
		<ButtonContent
			leadingIcon={leadingIcon}
			pendingLabel={pendingLabel}
			reservePendingWidth={
				reservePendingWidth && !("href" in props && props.href)
			}
			trailingIcon={trailingIcon}
		>
			{children}
		</ButtonContent>
	);
	const common = {
		"aria-busy": pending || undefined,
		"aria-controls": injected["aria-controls"],
		"aria-describedby": describedBy,
		"aria-disabled": disabled || pending || undefined,
		"aria-expanded": injected["aria-expanded"],
		"aria-haspopup": injected["aria-haspopup"],
		"aria-keyshortcuts": ariaKeyShortcuts,
		"aria-label": ariaLabel,
		className: BUTTON_GLASS[variant],
		"data-closed": injected["data-closed"],
		"data-open": injected["data-open"],
		"data-pending": pending ? "" : undefined,
		"data-size": size,
		"data-slot": "button",
		"data-variant": variant,
		disabled: disabled || pending,
		focusableWhenDisabled: focusableWhenDisabled || pending,
		form,
		id: injected.id,
		name,
		onKeyDown: injected.onKeyDown,
		onPointerDown: injected.onPointerDown,
		pendingAnnouncement,
		ref: injected.ref as Ref<HTMLButtonElement> | undefined,
		tabIndex: injected.tabIndex,
		type,
		value,
	} as const;

	if ("href" in props && props.href) {
		return (
			<NavigationLink
				ariaLabel={ariaLabel}
				describedBy={describedBy}
				disabled={disabled || pending}
				focusableWhenDisabled={focusableWhenDisabled || pending}
				href={props.href}
				injected={injected}
				onNavigate={props.onNavigate}
				openInNewTab={props.openInNewTab}
				size={size}
				slot="button"
				variant={props.variant ?? "secondary"}
			>
				{content}
			</NavigationLink>
		);
	}

	const confirmation = props.confirmation;
	const onAction = props.onAction;
	return (
		<BehaviorButton
			{...common}
			aria-label={ariaLabel}
			data-agent-confirm={confirmation?.title}
			onClick={async (_event, details) => {
				injected.onClick?.(_event);
				if (_event.defaultPrevented) return;
				if (!onAction) {
					return;
				}
				const actionDetails = interactionDetails(details);
				if (
					variant === "destructive" &&
					confirmation &&
					shouldConfirmLocally(actionDetails.source)
				) {
					const accepted = await confirm(confirmation);
					if (!accepted) {
						return;
					}
				}
				return onAction(actionDetails);
			}}
		>
			{content}
		</BehaviorButton>
	);
}

export function DestructiveDialogLauncher({
	ariaLabel,
	children,
	describedBy,
	onOpenChange,
	ref,
	size = "medium",
}: Pick<
	ButtonCommonProps,
	"ariaLabel" | "children" | "describedBy" | "size"
> & {
	onOpenChange: (open: true) => void;
	ref?: Ref<HTMLButtonElement>;
}) {
	return (
		<BehaviorButton
			aria-describedby={describedBy}
			aria-haspopup="dialog"
			aria-label={ariaLabel}
			className={BUTTON_GLASS.destructive}
			data-size={size}
			data-slot="button"
			data-variant="destructive"
			onClick={() => onOpenChange(true)}
			ref={ref}
			type="button"
		>
			<ButtonContent>{children}</ButtonContent>
		</BehaviorButton>
	);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;

export type IconButtonProps = DistributiveOmit<
	ButtonProps,
	"ariaLabel" | "children"
> & {
	icon: ReactNode;
	label: string;
};

export function IconButton({ icon, label, ...props }: IconButtonProps) {
	const content = (
		<span aria-hidden="true" data-slot="button-icon">
			{icon}
		</span>
	);
	if (props.variant === "destructive") {
		return (
			<Button {...props} ariaLabel={label}>
				{content}
			</Button>
		);
	}
	return (
		<Button {...props} ariaLabel={label}>
			{content}
		</Button>
	);
}

export interface IconToggleProps {
	icon: ReactNode;
	label: string;
	onPressedChange: (pressed: boolean) => void;
	pressed: boolean;
	size?: ButtonSize;
}

export function IconToggle({
	icon,
	label,
	onPressedChange,
	pressed,
	size = "medium",
}: IconToggleProps) {
	return (
		<Toggle
			aria-label={label}
			data-icon-toggle=""
			data-size={size}
			data-variant="ghost"
			onPressedChange={onPressedChange}
			pressed={pressed}
		>
			<span data-slot="button-label">
				<span aria-hidden="true" data-slot="button-icon">
					{icon}
				</span>
			</span>
		</Toggle>
	);
}

export interface ActionLinkProps {
	children: string;
	href: string;
	onNavigate?: (href: string, details: InteractionDetails) => unknown;
	openInNewTab?: boolean;
	size?: ButtonSize;
	variant?: Exclude<ButtonVariant, "destructive">;
}

export function ActionLink({
	children,
	href,
	onNavigate,
	openInNewTab = false,
	size = "medium",
	variant = "secondary",
}: ActionLinkProps) {
	return (
		<NavigationLink
			ariaLabel={children}
			href={href}
			onNavigate={onNavigate}
			openInNewTab={openInNewTab}
			size={size}
			slot="action-link"
			variant={variant}
		>
			{children}
		</NavigationLink>
	);
}
