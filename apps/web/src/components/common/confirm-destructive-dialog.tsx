import { DestructiveDialog } from "@tripwire/ui/dialog";
import type { ReactNode } from "react";

export interface ConfirmDestructiveDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	confirmLabel: string;
	pendingLabel: string;
	confirmText?: string;
	media?: ReactNode;
	onConfirm: () => undefined | Promise<unknown>;
}

export function ConfirmDestructiveDialog(props: ConfirmDestructiveDialogProps) {
	return <DestructiveDialog {...props} />;
}
