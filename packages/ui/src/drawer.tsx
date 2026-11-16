import type { ConfirmOptions } from "@ui-sdk/core/alert-dialog";
import {
	Drawer as BehaviorDrawer,
	DrawerBackdrop,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHandle,
	DrawerTitle,
	DrawerTrigger,
} from "@ui-sdk/react/drawer";
import type { ReactElement, ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";
import { type InteractionDetails, interactionDetails } from "./interaction";

export type DrawerSide = "left" | "right" | "bottom";

interface DrawerOptions {
	bodyInset?: "default" | "content";
	children: ReactNode;
	closeLabel?: string;
	description?: ReactNode;
	dismissible?: boolean;
	footer?: ReactNode;
	headerLeading?: ReactNode;
	headerTrailing?: ReactNode;
	onOpenChange?: (open: boolean, details: InteractionDetails) => void;
	primaryAction?: DrawerAction;
	secondaryAction?: DrawerAction;
	showCloseAction?: boolean;
	showFooter?: boolean;
	showHeader?: boolean;
	side?: DrawerSide;
	title: ReactNode;
	trigger?: ReactElement<object>;
	width?: "large" | "medium" | "small";
}

type DrawerOpenState =
	| { open: boolean; defaultOpen?: never }
	| { open?: never; defaultOpen?: boolean };

export type DrawerProps = DrawerOptions & DrawerOpenState;

interface DrawerActionBase {
	disabled?: boolean;
	label: string;
	onAction: (details: InteractionDetails) => unknown;
	pending?: boolean;
}

export type DrawerAction =
	| (DrawerActionBase & {
			confirmation?: never;
			variant?: Extract<ButtonVariant, "primary" | "secondary">;
	  })
	| (DrawerActionBase & {
			confirmation: ConfirmOptions;
			variant: "destructive";
	  });

function DrawerActionButton({
	action,
	fallback,
}: {
	action: DrawerAction;
	fallback: "primary" | "secondary";
}) {
	if (action.variant === "destructive") {
		return (
			<Button
				confirmation={action.confirmation}
				disabled={action.disabled}
				onAction={action.onAction}
				pending={action.pending}
				variant="destructive"
			>
				{action.label}
			</Button>
		);
	}
	return (
		<Button
			disabled={action.disabled}
			onAction={action.onAction}
			pending={action.pending}
			variant={action.variant ?? fallback}
		>
			{action.label}
		</Button>
	);
}

export function Drawer({
	bodyInset = "default",
	children,
	closeLabel = "Close",
	defaultOpen,
	description,
	dismissible = true,
	footer,
	headerLeading,
	headerTrailing,
	onOpenChange,
	open,
	primaryAction,
	secondaryAction,
	showCloseAction = true,
	showFooter = true,
	showHeader = true,
	side = "right",
	title,
	trigger,
	width = "medium",
}: DrawerProps) {
	return (
		<BehaviorDrawer
			defaultOpen={defaultOpen}
			dismissible={dismissible}
			modal
			onOpenChange={(open, details) =>
				onOpenChange?.(open, interactionDetails(details))
			}
			open={open}
			side={side}
		>
			{trigger ? (
				<DrawerTrigger data-slot="drawer-trigger" render={trigger} />
			) : null}
			<DrawerBackdrop data-slot="drawer-backdrop" />
			<DrawerContent
				data-side={side}
				data-slot="drawer-content"
				data-width={width}
			>
				{side === "bottom" ? (
					<DrawerHandle aria-label="Resize drawer" data-slot="drawer-handle" />
				) : null}
				<div data-slot="drawer-panel">
					{showHeader ? (
						<header data-slot="dialog-header">
							{headerLeading ? (
								<div data-slot="dialog-header-leading">{headerLeading}</div>
							) : null}
							<div data-slot="dialog-heading">
								<DrawerTitle data-slot="dialog-title">{title}</DrawerTitle>
								{description ? (
									<DrawerDescription data-slot="dialog-description">
										{description}
									</DrawerDescription>
								) : null}
							</div>
							{headerTrailing ? (
								<div data-slot="dialog-header-trailing">{headerTrailing}</div>
							) : null}
						</header>
					) : (
						<DrawerTitle data-slot="dialog-title" hidden>
							{title}
						</DrawerTitle>
					)}
					<div data-inset={bodyInset} data-slot="dialog-body">
						{children}
					</div>
				</div>
				{showFooter ? (
					<footer data-slot="dialog-footer">
						{footer}
						{secondaryAction ? (
							<DrawerActionButton
								action={secondaryAction}
								fallback="secondary"
							/>
						) : null}
						{primaryAction ? (
							<DrawerActionButton action={primaryAction} fallback="primary" />
						) : null}
						{showCloseAction ? (
							<DrawerClose
								render={<Button variant="secondary">{closeLabel}</Button>}
							/>
						) : null}
					</footer>
				) : null}
			</DrawerContent>
		</BehaviorDrawer>
	);
}

export type SheetProps = Omit<DrawerOptions, "side"> &
	DrawerOpenState & {
		side?: Exclude<DrawerSide, "bottom">;
	};

export function Sheet(props: SheetProps) {
	return <Drawer {...props} side={props.side ?? "right"} />;
}
