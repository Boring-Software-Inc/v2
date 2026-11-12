import { type ReactNode, useId } from "react";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	useDialog,
} from "#/design-system/ui/dialog";

export interface ConfirmDestructiveDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	actionLabel: string;
	pendingLabel: string;
	confirmText?: string;
	media?: ReactNode;
	onConfirm: () => undefined | Promise<unknown>;
}

export function ConfirmDestructiveDialog({
	open,
	onOpenChange,
	title,
	description,
	actionLabel,
	pendingLabel,
	confirmText,
	media,
	onConfirm,
}: ConfirmDestructiveDialogProps) {
	return (
		<Dialog
			confirmText={confirmText}
			onOpenChange={onOpenChange}
			open={open}
			role="alertdialog"
		>
			<DialogContent size="sm">
				<DialogHeader>
					{media ? (
						<div className="flex" data-layout-role="destructive-dialog-media">
							{media}
						</div>
					) : null}
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{confirmText === undefined ? null : (
					<DialogBody>
						<TypeToConfirm />
					</DialogBody>
				)}
				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					<DialogAction
						onAction={onConfirm}
						pendingLabel={pendingLabel}
						variant="destructive"
					>
						{actionLabel}
					</DialogAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TypeToConfirm() {
	const { confirmText, typed, setTyped, pending, matched } = useDialog();
	const id = useId();
	if (confirmText === undefined) return null;
	const mismatch = typed.trim().length > 0 && !matched;
	return (
		<div
			className="flex flex-col"
			data-layout-role="destructive-confirmation-field"
		>
			<label data-layout-role="destructive-confirmation-label" htmlFor={id}>
				Type{" "}
				<span
					className="mono rounded-tag break-all select-all"
					data-layout-role="destructive-confirmation-value"
				>
					{confirmText}
				</span>{" "}
				to confirm
			</label>
			<input
				aria-invalid={mismatch || undefined}
				autoCapitalize="off"
				autoComplete="off"
				autoCorrect="off"
				className="field w-full"
				data-autofocus
				data-layout-role="destructive-confirmation-input"
				id={id}
				onChange={(event) => setTyped(event.target.value)}
				readOnly={pending}
				spellCheck={false}
				value={typed}
			/>
		</div>
	);
}
