import { createContext, useContext, type ReactNode } from "react";

export interface DestructiveConfirmationOptions {
	title?: string;
	description?: ReactNode;
	actionLabel?: string;
	pendingLabel?: string;
	confirmText?: string;
	media?: ReactNode;
}

export interface DestructiveConfirmationRequest {
	options: Required<
		Pick<
			DestructiveConfirmationOptions,
			"title" | "description" | "actionLabel" | "pendingLabel"
		>
	> &
		Pick<DestructiveConfirmationOptions, "confirmText" | "media">;
	onConfirm: () => undefined | Promise<unknown>;
}

type RequestDestructiveConfirmation = (
	request: DestructiveConfirmationRequest,
) => void;

const missingProvider: RequestDestructiveConfirmation = () => {
	throw new Error(
		"Destructive buttons require DestructiveConfirmationProvider.",
	);
};

export const DestructiveConfirmationContext =
	createContext<RequestDestructiveConfirmation>(missingProvider);

export function useDestructiveConfirmation(): RequestDestructiveConfirmation {
	return useContext(DestructiveConfirmationContext);
}

export function resolveDestructiveConfirmation(
	label: string,
	options: DestructiveConfirmationOptions | undefined,
): DestructiveConfirmationRequest["options"] {
	const actionLabel = options?.actionLabel ?? label;
	return {
		title: options?.title ?? `${actionLabel}?`,
		description:
			options?.description ??
			"This action can affect saved data or access. Confirm before continuing.",
		actionLabel,
		pendingLabel: options?.pendingLabel ?? "Working",
		confirmText: options?.confirmText,
		media: options?.media,
	};
}
