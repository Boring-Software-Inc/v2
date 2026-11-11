import type { ReactNode } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";

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
		<ConfirmDestructiveDialog
			actionLabel={actionLabel}
			confirmText={confirmText}
			description={description ?? "This action can't be undone."}
			media={media}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			pendingLabel={pendingLabel}
			title={title}
		/>
	);
}
