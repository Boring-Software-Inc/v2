import { type ConfirmOptions, confirm } from "@ui-sdk/core/alert-dialog";
import { type ToastActionDetails, toast } from "@ui-sdk/react/toast";
import {
	type InteractionDetails,
	interactionDetails,
	shouldConfirmLocally,
} from "./interaction";

export type ToastTone = "default" | "success" | "error" | "info" | "warning";

export interface ToastMessage {
	action?: ToastAction;
	description?: string;
	duration?: number | "long" | "persistent" | "short";
	id?: string;
	title: string;
}

export type ToastAction =
	| {
			confirmation?: never;
			label: string;
			onAction: (details: InteractionDetails) => unknown;
			variant?: "default";
	  }
	| {
			confirmation: ConfirmOptions;
			label: string;
			onAction: (details: InteractionDetails) => unknown;
			variant: "destructive";
	  };

function duration(value: ToastMessage["duration"]) {
	switch (value) {
		case "persistent":
			return Number.POSITIVE_INFINITY;
		case "short":
			return 3000;
		case "long":
			return 10_000;
		default:
			return value;
	}
}

function options(message: ToastMessage, dismiss: () => void) {
	const { action } = message;
	return {
		action: action
			? {
					label: action.label,
					dismiss: action.variant !== "destructive",
					onAction: async (
						_event: Event | undefined,
						details: ToastActionDetails,
					) => {
						const interaction = interactionDetails(details);
						if (action.variant !== "destructive") {
							return action.onAction(interaction);
						}
						if (shouldConfirmLocally(interaction.source)) {
							const accepted = await confirm(action.confirmation);
							if (!accepted) return;
						}
						const result = await action.onAction(interaction);
						dismiss();
						return result;
					},
				}
			: undefined,
		description: message.description,
		duration: duration(message.duration),
		id: message.id,
		title: message.title,
	};
}

export const notify = {
	show(message: ToastMessage, tone: ToastTone = "default") {
		const show = tone === "default" ? toast : toast[tone];
		const id: string = show(options(message, () => toast.dismiss(id)));
		return id;
	},
	loading(message: ToastMessage) {
		const id: string = toast.loading(options(message, () => toast.dismiss(id)));
		return id;
	},
	update(id: string, message: ToastMessage) {
		return toast.update(
			id,
			options(message, () => toast.dismiss(id)),
		);
	},
	dismiss(id?: string) {
		toast.dismiss(id);
	},
};
