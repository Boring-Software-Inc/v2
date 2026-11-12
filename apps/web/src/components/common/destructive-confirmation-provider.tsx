import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import {
	DestructiveConfirmationContext,
	type DestructiveConfirmationRequest,
} from "#/design-system/ui/destructive-confirmation-context";

export function DestructiveConfirmationProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [request, setRequest] = useState<DestructiveConfirmationRequest | null>(
		null,
	);
	const requestConfirmation = useCallback(
		(next: DestructiveConfirmationRequest) => setRequest(next),
		[],
	);
	const value = useMemo(() => requestConfirmation, [requestConfirmation]);

	return (
		<DestructiveConfirmationContext value={value}>
			{children}
			{request ? (
				<ConfirmDestructiveDialog
					actionLabel={request.options.actionLabel}
					confirmText={request.options.confirmText}
					description={request.options.description}
					media={request.options.media}
					onConfirm={request.onConfirm}
					onOpenChange={(open) => {
						if (!open) setRequest(null);
					}}
					open
					pendingLabel={request.options.pendingLabel}
					title={request.options.title}
				/>
			) : null}
		</DestructiveConfirmationContext>
	);
}
