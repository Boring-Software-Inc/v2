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
} from "#/components/glaze/ui/dialog";

export interface ConfirmDeleteDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	actionLabel?: string;
	pendingLabel?: string;
	confirmText?: string;
	media?: ReactNode;
	onConfirm: () => Promise<unknown> | undefined;
}

export function ConfirmDeleteDialog({
	open,
	onOpenChange,
	title,
	description,
	actionLabel = "Delete",
	pendingLabel = "Deleting",
	confirmText,
	media,
	onConfirm,
}: ConfirmDeleteDialogProps) {
	return (
		<Dialog
			confirmText={confirmText}
			onOpenChange={onOpenChange}
			open={open}
			role="alertdialog"
		>
			<DialogContent size="sm">
				<DialogHeader>
					{media ? <div className="mb-3 flex">{media}</div> : null}
					<DialogTitle>{title}</DialogTitle>
					{description ? (
						<DialogDescription>{description}</DialogDescription>
					) : null}
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
	if (confirmText === undefined) {
		return null;
	}
	const mismatch = typed.trim().length > 0 && !matched;
	return (
		<div className="flex flex-col gap-2">
			<label className="type-label text-text-1" htmlFor={id}>
				Type{" "}
				<span className="mono rounded-tag bg-field px-1 break-all select-all">
					{confirmText}
				</span>{" "}
				to confirm
			</label>
			<input
				aria-invalid={mismatch || undefined}
				autoCapitalize="off"
				autoComplete="off"
				autoCorrect="off"
				className="field w-full type-body-sm read-only:text-text-2"
				data-autofocus
				id={id}
				onChange={(event) => setTyped(event.target.value)}
				readOnly={pending}
				spellCheck={false}
				value={typed}
			/>
		</div>
	);
}
