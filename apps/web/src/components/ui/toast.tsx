"use client";

import {
	CircleCheckIcon,
	CircleXIcon,
	InfoIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
import { toast as sonner } from "sonner";
import { Toaster as SonnerToaster } from "#/components/ui/sonner";
import {
	getAnnouncementSnapshot,
	pushAnnouncement,
	subscribeAnnouncement,
} from "#/lib/toast-announcer";
import {
	createToastController,
	type ToastCardState,
	type ToastController,
	type ToastInput,
	type ToastStatus,
} from "#/lib/toast-controller";
import { cn } from "#/lib/utils";

/** Snappy scale pop — the design system's "small quick pop" spring. Replayed on
 * every re-fire (the card remounts on `bump`) so a repeat visibly bounces. */
const POP = { type: "spring", stiffness: 540, damping: 34 } as const;

const STATUS_ICON: Record<
	Exclude<ToastStatus, "default">,
	{ Icon: typeof InfoIcon; className: string }
> = {
	success: {
		Icon: CircleCheckIcon,
		className: "text-emerald-600 dark:text-emerald-400",
	},
	error: { Icon: CircleXIcon, className: "text-red-600 dark:text-red-400" },
	warning: {
		Icon: TriangleAlertIcon,
		className: "text-amber-600 dark:text-amber-400",
	},
	info: { Icon: InfoIcon, className: "text-brand" },
};

function ToastCard({ state }: { state: ToastCardState }) {
	const reduce = useReducedMotion();
	const status = state.status === "default" ? null : STATUS_ICON[state.status];

	const inner = (
		<div className="w-full overflow-hidden rounded-lg border bg-background shadow-lg">
			<div className="flex items-start gap-3 px-4 py-3">
				{status ? (
					<status.Icon
						className={cn("mt-px size-4 shrink-0", status.className)}
					/>
				) : null}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="font-medium text-[13px]/5 text-foreground">
						{state.title}
					</span>
					{state.body ? (
						<span className="text-[13px]/5 text-muted-foreground">
							{state.body}
						</span>
					) : null}
				</div>
				{state.count >= 2 ? (
					<span className="mt-px shrink-0 rounded-full bg-surface-1 px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground tabular-nums">
						{state.count}
					</span>
				) : null}
				<button
					aria-label="dismiss"
					className="mt-px shrink-0 text-muted-foreground transition-colors hover:text-foreground"
					onClick={() => sonner.dismiss(state.id)}
					type="button"
				>
					<XIcon className="size-4" />
				</button>
			</div>
			{/* Action toasts carry the button in a bordered footer, right-aligned
			    at the very bottom — separated from the message above it. */}
			{state.action ? (
				<div className="flex justify-end border-t px-4 py-2">
					<button
						className="rounded-md bg-primary px-3 py-1.5 font-medium text-[13px] text-primary-foreground transition-opacity hover:opacity-90"
						onClick={() => {
							state.action?.onClick();
							sonner.dismiss(state.id);
						}}
						type="button"
					>
						{state.action.label}
					</button>
				</div>
			) : null}
		</div>
	);

	if (reduce) {
		return inner;
	}
	// Keyed by `bump` so a re-fire remounts and replays the pop — the visible
	// "re-highlight" that pairs with the spoken count.
	return (
		<motion.div
			animate={{ scale: 1, opacity: 1 }}
			initial={{ scale: 0.97, opacity: 0.7 }}
			key={state.bump}
			transition={POP}
		>
			{inner}
		</motion.div>
	);
}

let controller: ToastController;
controller = createToastController({
	render: (state) => {
		sonner.custom((_id) => <ToastCard state={state} />, {
			id: state.id,
			duration: Number.POSITIVE_INFINITY,
			// A user swipe/close cleans the registry so a later identical fire is
			// a fresh count-1 toast, not a resurrected one.
			onDismiss: () => controller.handleDismiss(state.id),
		});
	},
	dismiss: (id) => {
		sonner.dismiss(id);
	},
	schedule: (fn, ms) => setTimeout(fn, ms),
	cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	announce: (text) => pushAnnouncement(text),
});

type ToastArg = string | ToastInput;

function normalize(arg: ToastArg): ToastInput {
	return typeof arg === "string" ? { title: arg } : arg;
}

function withStatus(arg: ToastArg, status: ToastStatus): ToastInput {
	return { ...normalize(arg), status };
}

/**
 * Drop-in replacement for sonner's `toast`: `toast("saved")` and
 * `toast.success("saved")` keep their shape, and the richer object form
 * (`toast({ title, body, action, dedupeKey })`) reaches the title+body and
 * action variants. Every call routes through the dedupe controller, so repeats
 * re-highlight one card instead of stacking.
 */
export const toast = Object.assign(
	(arg: ToastArg) => controller.fire(normalize(arg)),
	{
		success: (arg: ToastArg) => controller.fire(withStatus(arg, "success")),
		error: (arg: ToastArg) => controller.fire(withStatus(arg, "error")),
		info: (arg: ToastArg) => controller.fire(withStatus(arg, "info")),
		warning: (arg: ToastArg) => controller.fire(withStatus(arg, "warning")),
		message: (arg: ToastArg) => controller.fire(normalize(arg)),
		dismiss: (id?: string) => sonner.dismiss(id),
	},
);

/** Visually-hidden aria-live region that re-speaks a re-fire (the count) which
 * sonner's in-place content swap does not re-announce. */
function ToastAnnouncer() {
	const snapshot = useSyncExternalStore(
		subscribeAnnouncement,
		getAnnouncementSnapshot,
		getAnnouncementSnapshot,
	);
	return (
		<div aria-atomic="true" aria-live="polite" className="sr-only">
			{snapshot.text}
		</div>
	);
}

/** The renderer + announcer, mounted once at the root. */
export function Toaster() {
	return (
		<>
			<SonnerToaster />
			<ToastAnnouncer />
		</>
	);
}
