import {
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
	AlertDialogTrigger,
	AlertDialog as BehaviorAlertDialog,
} from "@ui-sdk/react/alert-dialog";
import {
	Dialog as BehaviorDialog,
	DialogBackdrop,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@ui-sdk/react/dialog";
import { type ReactElement, type ReactNode, useId, useState } from "react";
import type { AgentVisibility } from "./agent-policy";
import { Button, type ButtonSize } from "./button";
import { Close, Failed, Icon } from "./icon";
import { type InteractionDetails, interactionDetails } from "./interaction";
import { OverlayPortal } from "./overlay-portal";

export interface DialogActionBase {
	disabled?: boolean;
	label: string;
	pendingLabel?: string;
	value?: string;
	variant?: "primary";
}

export interface DialogSafeAction extends DialogActionBase {
	dismissOnSuccess?: boolean;
	href?: never;
	onAction: (details: InteractionDetails) => unknown;
	onNavigate?: never;
	openInNewTab?: never;
}

export interface DialogNavigationAction extends DialogActionBase {
	href: string;
	onAction?: never;
	onNavigate?: (href: string, details: InteractionDetails) => unknown;
	openInNewTab?: boolean;
}

export type DialogAction = DialogSafeAction | DialogNavigationAction;

interface DialogBaseProps {
	action?: DialogAction;
	agentVisibility?: AgentVisibility;
	cancelLabel?: string;
	children: ReactNode;
	description?: ReactNode;
	finalFocus?: () => HTMLElement | null;
	headerLeading?: ReactNode;
	headerTrailing?: ReactNode;
	initialFocus?: "content" | "first-field";
	showCancel?: boolean;
	showFooter?: boolean;
	showHeader?: boolean;
	size?: "small" | "medium";
	title: ReactNode;
	trigger?: ReactElement<object>;
}

interface ControlledDialogProps extends DialogBaseProps {
	defaultOpen?: never;
	onOpenChange: (open: boolean, details: InteractionDetails) => void;
	open: boolean;
}

interface UncontrolledDialogProps extends DialogBaseProps {
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	open?: never;
}

export type DialogProps = ControlledDialogProps | UncontrolledDialogProps;

export function Dialog({
	action,
	agentVisibility = "visible",
	cancelLabel = "Cancel",
	children,
	defaultOpen,
	description,
	finalFocus,
	headerLeading,
	headerTrailing,
	initialFocus,
	onOpenChange,
	open,
	showCancel = true,
	showFooter = true,
	showHeader = true,
	size = "medium",
	title,
	trigger,
}: DialogProps) {
	const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
	const [actionPending, setActionPending] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const controlled = open !== undefined;
	const currentOpen = controlled ? open : internalOpen;
	const changeOpen = (next: boolean, details: InteractionDetails) => {
		if (actionPending) return;
		setActionError(null);
		if (!controlled) setInternalOpen(next);
		onOpenChange?.(next, details);
	};
	const runAction = async (
		safeAction: DialogSafeAction,
		details: InteractionDetails,
	) => {
		if (actionPending) return;
		setActionPending(true);
		setActionError(null);
		try {
			await safeAction.onAction(details);
			if (safeAction.dismissOnSuccess !== false) {
				if (!controlled) setInternalOpen(false);
				onOpenChange?.(false, details);
			}
		} catch (error) {
			setActionError(
				error instanceof Error && error.message
					? error.message
					: "The action failed. Try again.",
			);
		} finally {
			setActionPending(false);
		}
	};
	return (
		<BehaviorDialog
			onOpenChange={(next, details) =>
				changeOpen(next, interactionDetails(details))
			}
			open={currentOpen}
		>
			{trigger ? (
				<DialogTrigger data-slot="dialog-trigger" render={trigger} />
			) : null}
			<OverlayPortal>
				<DialogBackdrop data-slot="dialog-backdrop" />
				<DialogContent
					aria-busy={actionPending || undefined}
					data-agent-hidden={agentVisibility === "hidden" ? "" : undefined}
					data-has-footer={showFooter ? "" : undefined}
					data-size={size}
					data-slot="dialog-content"
					finalFocus={finalFocus}
					initialFocus={
						initialFocus === "first-field"
							? "input, textarea, select, [role='combobox']"
							: initialFocus
					}
				>
					<div data-slot="dialog-panel">
						{showHeader ? (
							<header data-slot="dialog-header">
								{headerLeading ? (
									<div data-slot="dialog-header-leading">{headerLeading}</div>
								) : null}
								<div data-slot="dialog-heading">
									<DialogTitle data-slot="dialog-title">{title}</DialogTitle>
									{description ? (
										<DialogDescription data-slot="dialog-description">
											{description}
										</DialogDescription>
									) : null}
								</div>
								{headerTrailing ? (
									<div data-slot="dialog-header-trailing">{headerTrailing}</div>
								) : (
									<DialogClose
										aria-label="Close"
										data-slot="dialog-close-button"
										disabled={actionPending}
									>
										<Icon icon={Close} />
									</DialogClose>
								)}
							</header>
						) : (
							<DialogTitle data-slot="dialog-title" hidden>
								{title}
							</DialogTitle>
						)}
						<div data-slot="dialog-body">{children}</div>
					</div>
					{actionError ? (
						<div data-slot="dialog-action-error" role="alert">
							<Icon icon={Failed} />
							<span>{actionError}</span>
						</div>
					) : null}
					{showFooter ? (
						<footer data-slot="dialog-footer">
							{showCancel ? (
								<span data-slot="dialog-cancel">
									<DialogClose disabled={actionPending}>
										{cancelLabel}
									</DialogClose>
								</span>
							) : null}
							{action?.href !== undefined ? (
								<Button
									disabled={action.disabled}
									href={action.href}
									onNavigate={action.onNavigate}
									openInNewTab={action.openInNewTab}
									size="small"
									value={action.value ?? "confirm"}
									variant={action.variant ?? "primary"}
								>
									{action.label}
								</Button>
							) : action ? (
								<Button
									disabled={action.disabled}
									onAction={(details) => runAction(action, details)}
									pending={actionPending}
									pendingLabel={action.pendingLabel}
									size="small"
									value={action.value ?? "confirm"}
									variant={action.variant ?? "primary"}
								>
									{actionPending && action.pendingLabel
										? action.pendingLabel
										: action.label}
								</Button>
							) : null}
						</footer>
					) : null}
				</DialogContent>
			</OverlayPortal>
		</BehaviorDialog>
	);
}

export interface AlertDialogProps {
	cancelLabel?: string;
	confirmLabel: string;
	description: ReactNode;
	onConfirm: (details: InteractionDetails) => unknown;
	title: string;
	trigger: ReactElement<object>;
}

export function AlertDialog({
	cancelLabel = "Cancel",
	confirmLabel,
	description,
	onConfirm,
	title,
	trigger,
}: AlertDialogProps) {
	return (
		<BehaviorAlertDialog>
			<AlertDialogTrigger data-slot="alert-dialog-trigger" render={trigger} />
			<OverlayPortal>
				<AlertDialogBackdrop data-slot="alert-dialog-backdrop" />
				<AlertDialogContent data-slot="alert-dialog-content">
					<div data-slot="alert-dialog-panel">
						<AlertDialogTitle data-slot="dialog-title">
							{title}
						</AlertDialogTitle>
						<AlertDialogDescription data-slot="dialog-description">
							{description}
						</AlertDialogDescription>
					</div>
					<footer data-slot="dialog-footer">
						<span data-slot="dialog-cancel">
							<AlertDialogClose>{cancelLabel}</AlertDialogClose>
						</span>
						<span data-slot="alert-dialog-action">
							<AlertDialogClose
								className="glass glass-coral"
								action={(_event, details) =>
									onConfirm(interactionDetails(details))
								}
								data-agent-confirm={title}
								value="confirm"
							>
								{confirmLabel}
							</AlertDialogClose>
						</span>
					</footer>
				</AlertDialogContent>
			</OverlayPortal>
		</BehaviorAlertDialog>
	);
}

export interface DestructiveDialogProps {
	agentVisibility?: AgentVisibility;
	confirmLabel: string;
	confirmText?: string;
	description: ReactNode;
	finalFocus?: () => HTMLElement | null;
	media?: ReactNode;
	onConfirm: (details: InteractionDetails) => unknown | Promise<unknown>;
	onOpenChange: (open: boolean, details?: InteractionDetails) => void;
	open: boolean;
	pendingLabel: string;
	secondaryAction?: {
		label: string;
		onAction: (details: InteractionDetails) => unknown;
	};
	title: string;
	trigger?: {
		ariaLabel?: string;
		disabled?: boolean;
		label: string;
		size?: ButtonSize;
	};
	variant?: "primary" | "destructive";
}

export function DestructiveDialog({
	agentVisibility = "visible",
	confirmLabel,
	confirmText,
	description,
	finalFocus,
	media,
	onConfirm,
	onOpenChange,
	open,
	pendingLabel,
	secondaryAction,
	title,
	trigger,
	variant = "destructive",
}: DestructiveDialogProps) {
	const inputId = useId();
	const [typed, setTyped] = useState("");
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const matched = confirmText === undefined || typed === confirmText;

	const changeOpen = (next: boolean, details?: InteractionDetails) => {
		if (pending) return;
		if (!next) {
			setTyped("");
			setFailed(false);
		}
		onOpenChange(next, details);
	};
	const runConfirm = async (details: InteractionDetails) => {
		if (!matched || pending) return;
		setPending(true);
		setFailed(false);
		try {
			await onConfirm(details);
			setTyped("");
			onOpenChange(false, details);
		} catch (error) {
			setFailed(true);
			throw error;
		} finally {
			setPending(false);
		}
	};
	return (
		<BehaviorAlertDialog
			onOpenChange={(next, details) =>
				changeOpen(next, interactionDetails(details))
			}
			open={open}
		>
			{trigger ? (
				<AlertDialogTrigger
					disabled={trigger.disabled}
					render={(props) => (
						<button
							{...props}
							aria-label={trigger.ariaLabel}
							className="glass glass-coral"
							data-size={trigger.size ?? "medium"}
							data-slot="button"
							data-variant="destructive"
							type="button"
						>
							{trigger.label}
						</button>
					)}
				/>
			) : null}
			<OverlayPortal>
				<AlertDialogBackdrop data-slot="alert-dialog-backdrop" />
				<AlertDialogContent
					data-agent-hidden={agentVisibility === "hidden" ? "" : undefined}
					data-slot="alert-dialog-content"
					finalFocus={finalFocus}
					initialFocus='[data-slot="dialog-cancel"] button'
				>
					<div data-slot="dialog-form">
						<div data-slot="alert-dialog-panel">
							{media ? <div data-slot="dialog-media">{media}</div> : null}
							<AlertDialogTitle data-slot="dialog-title">
								{title}
							</AlertDialogTitle>
							<AlertDialogDescription data-slot="dialog-description">
								{description}
							</AlertDialogDescription>
							{confirmText === undefined ? null : (
								<div data-slot="dialog-confirmation-field">
									<label htmlFor={inputId}>
										Type <strong>{confirmText}</strong> to confirm
									</label>
									<input
										autoCapitalize="off"
										autoComplete="off"
										disabled={pending}
										id={inputId}
										onChange={(event) => setTyped(event.target.value)}
										spellCheck={false}
										value={typed}
									/>
								</div>
							)}
							{failed ? (
								<p data-slot="alert-dialog-error" role="alert">
									The action failed. Try again.
								</p>
							) : null}
						</div>
						<footer data-slot="dialog-footer">
							{secondaryAction ? (
								<span data-slot="dialog-secondary-action">
									<Button
										disabled={pending}
										onAction={secondaryAction.onAction}
										size="small"
										variant="secondary"
									>
										{secondaryAction.label}
									</Button>
								</span>
							) : null}
							<span data-slot="dialog-cancel">
								<AlertDialogClose disabled={pending}>Cancel</AlertDialogClose>
							</span>
							<span data-slot="alert-dialog-action" data-variant={variant}>
								<AlertDialogClose
									className={
										variant === "primary"
											? "glass glass-ink"
											: "glass glass-coral"
									}
									action={(_event, details) =>
										runConfirm(interactionDetails(details))
									}
									data-agent-confirm={title}
									disabled={!matched || pending}
									value="confirm"
								>
									{pending ? pendingLabel : confirmLabel}
								</AlertDialogClose>
							</span>
						</footer>
					</div>
				</AlertDialogContent>
			</OverlayPortal>
		</BehaviorAlertDialog>
	);
}
